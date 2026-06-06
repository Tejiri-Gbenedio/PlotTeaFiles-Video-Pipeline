import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import ffmpeg from 'fluent-ffmpeg';

export async function probeAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        reject(new Error(`Unable to probe audio duration for ${filePath}: ${error.message}`));
        return;
      }

      const streamDuration = metadata.streams
        .map((stream) => Number(stream.duration))
        .find((duration) => Number.isFinite(duration) && duration > 0);

      const duration = Number(metadata.format.duration) || streamDuration;

      if (!duration || !Number.isFinite(duration)) {
        reject(new Error(`ffprobe did not return a usable duration for ${filePath}`));
        return;
      }

      resolve(duration);
    });
  });
}

function concatFileLine(filePath: string): string {
  const normalized = path.resolve(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''");
  return `file '${normalized}'`;
}

export async function concatAudioFiles(
  inputFiles: string[],
  outputPath: string,
  listPath: string
): Promise<void> {
  if (inputFiles.length === 0) {
    throw new Error('Cannot concatenate zero audio files');
  }

  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await fs.mkdir(path.dirname(listPath), {recursive: true});
  await fs.writeFile(listPath, `${inputFiles.map(concatFileLine).join('\n')}\n`, 'utf8');

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c:a',
    'libmp3lame',
    '-b:a',
    '192k',
    outputPath
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, {stdio: ['ignore', 'ignore', 'pipe']});
    const chunks: Buffer[] = [];

    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const stderr = Buffer.concat(chunks).toString('utf8').trim();
      reject(new Error(`ffmpeg concat failed with exit code ${code}${stderr ? `: ${stderr}` : ''}`));
    });
  });
}
