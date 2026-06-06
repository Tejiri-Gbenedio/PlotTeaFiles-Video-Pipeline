import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {logger} from '../utils/logger.js';

export interface RenderOptions {
  propsPath: string;
  outputPath: string;
  entryPoint?: string;
  compositionId?: string;
  cache?: boolean;
  fallbackToRenderer?: boolean;
}

async function resolveDefaultEntryPoint(): Promise<string> {
  const compiledEntry = path.resolve('dist/remotion/Root.js');

  if (await exists(compiledEntry)) {
    return compiledEntry;
  }

  return path.resolve('src/remotion/Root.tsx');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runRemotionCli(
  entryPoint: string,
  compositionId: string,
  outputPath: string,
  propsPath: string
): Promise<void> {
  const command = process.execPath;
  const cliPath = path.resolve('node_modules/@remotion/cli/remotion-cli.js');
  const args = [
    cliPath,
    'render',
    entryPoint,
    compositionId,
    outputPath,
    `--props=${propsPath}`,
    '--overwrite'
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'inherit', 'pipe']});
    const chunks: Buffer[] = [];

    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      chunks.push(chunk);
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const stderr = Buffer.concat(chunks).toString('utf8').trim();
      reject(new Error(`Remotion CLI failed with exit code ${code}${stderr ? `: ${stderr}` : ''}`));
    });
  });
}

async function runRendererFallback(
  entryPoint: string,
  compositionId: string,
  outputPath: string,
  propsPath: string
): Promise<void> {
  const [{bundle}, {renderMedia, selectComposition}] = await Promise.all([
    import('@remotion/bundler'),
    import('@remotion/renderer')
  ]);
  const inputProps = JSON.parse(await fs.readFile(propsPath, 'utf8')) as Record<string, unknown>;
  const serveUrl = await bundle({entryPoint});
  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps
  });
}

export async function renderVideo(options: RenderOptions): Promise<string> {
  const propsPath = path.resolve(options.propsPath);
  const outputPath = path.resolve(options.outputPath);
  const entryPoint = options.entryPoint
    ? path.resolve(options.entryPoint)
    : await resolveDefaultEntryPoint();
  const compositionId = options.compositionId ?? 'PlotPipeStory';
  const useCache = options.cache !== false;

  if (useCache && (await exists(outputPath))) {
    logger.stage('render', `Using cached render: ${outputPath}`);
    return outputPath;
  }

  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  if (await exists(outputPath)) {
    await fs.unlink(outputPath);
  }

  logger.stage('render', `Rendering ${compositionId} to ${outputPath}`);

  try {
    await runRemotionCli(entryPoint, compositionId, outputPath, propsPath);
  } catch (error) {
    if (options.fallbackToRenderer === false) {
      throw error;
    }

    logger.warn('Remotion CLI failed; retrying with @remotion/renderer');
    await runRendererFallback(entryPoint, compositionId, outputPath, propsPath);
  }

  logger.success(`Video saved: ${outputPath}`);
  return outputPath;
}
