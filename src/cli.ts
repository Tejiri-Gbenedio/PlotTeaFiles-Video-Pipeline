#!/usr/bin/env node
import 'dotenv/config';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {Command, InvalidArgumentError} from 'commander';
import {composeRemotionProps} from './pipeline/compose.js';
import {ImageGenProvider, ImageQuality} from './pipeline/imagegen.js';
import {loadStoryScript, StoryScript} from './pipeline/parse.js';
import {getPipelinePaths} from './pipeline/paths.js';
import {renderVideo} from './pipeline/render.js';
import {generateSubtitles} from './pipeline/subtitles.js';
import {generateVoiceover} from './pipeline/voiceover.js';
import {formatError, logger} from './utils/logger.js';

interface CommonOptions {
  tmpDir: string;
  brollDir: string;
  provider: ImageGenProvider;
  imageQuality: ImageQuality;
  shotsPerSegment: number;
  imagegen?: boolean;
  cache?: boolean;
  fps: number;
  width: number;
  height: number;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Expected a positive integer');
  }

  return parsed;
}

function parseImageProvider(value: string): ImageGenProvider {
  if (value === 'gemini' || value === 'openai') {
    return value;
  }

  throw new InvalidArgumentError('Expected one of: gemini, openai');
}

function parseImageQuality(value: string): ImageQuality {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }

  throw new InvalidArgumentError('Expected one of: low, medium, high');
}

function requireEnv(keys: string[], stage: string): void {
  const missing = keys.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`${stage} requires missing env vars: ${missing.join(', ')}`);
  }
}

function requireVoiceEnv(story: StoryScript): void {
  const provider = (process.env.TTS_PROVIDER ?? 'openai').trim().toLowerCase();

  if (provider === 'openai') {
    requireEnv(['OPENAI_API_KEY'], 'Voiceover');
    return;
  }

  if (provider !== 'elevenlabs') {
    throw new Error(`Voiceover requires TTS_PROVIDER to be "openai" or "elevenlabs", got "${provider}"`);
  }

  requireEnv(['ELEVENLABS_API_KEY'], 'Voiceover');

  if (!story.voice_id && !process.env.ELEVENLABS_VOICE_ID) {
    throw new Error('Voiceover requires ELEVENLABS_VOICE_ID or story.voice_id');
  }
}

function requireImageEnv(options: CommonOptions): void {
  if (options.imagegen === false) {
    return;
  }

  if (options.provider === 'openai') {
    requireEnv(['OPENAI_API_KEY'], 'OpenAI image generation');
    return;
  }

  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
    throw new Error('Image generation requires GEMINI_API_KEY or OPENAI_API_KEY for fallback');
  }
}

async function runCommand(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logger.error(`${label} failed: ${formatError(error)}`);
    process.exitCode = 1;
  }
}

function addCommonOptions(command: Command): Command {
  return command
    .option('--tmp-dir <dir>', 'Directory for pipeline state', 'tmp')
    .option('--broll-dir <dir>', 'Directory containing local B-roll assets', 'assets/broll')
    .option('--fps <number>', 'Composition frames per second', parsePositiveInt, 30)
    .option('--width <number>', 'Composition width', parsePositiveInt, 1080)
    .option('--height <number>', 'Composition height', parsePositiveInt, 1920)
    .option('--provider <provider>', 'Image generation provider: gemini or openai', parseImageProvider, 'gemini')
    .option('--image-quality <quality>', 'OpenAI image quality: low, medium, or high', parseImageQuality, 'low')
    .option('--shots-per-segment <number>', 'Generated B-roll images per story segment', parsePositiveInt, 3)
    .option('--no-imagegen', 'Disable AI image generation for missing B-roll assets')
    .option('--no-cache', 'Regenerate stage outputs even when cache files exist');
}

const program = new Command();

program
  .name('plotpipe')
  .description('PlotTeaFiles short-form video pipeline CLI')
  .version('0.1.0');

addCommonOptions(
  program
    .command('run')
    .description('Run parse, voiceover, subtitles, compose, and render stages')
    .requiredOption('--script <file>', 'Story script JSON or TypeScript file')
    .requiredOption('--output <file>', 'Rendered MP4 output path')
).action((options: CommonOptions & {script: string; output: string}) =>
  runCommand('run', async () => {
    const story = await loadStoryScript(options.script, {tmpDir: options.tmpDir});
    requireVoiceEnv(story);
    requireEnv(['OPENAI_API_KEY'], 'Subtitles');

    logger.stage('parse', `Loaded story "${story.title}" (${story.segments.length} segments)`);

    const voiceover = await generateVoiceover(story, {
      tmpDir: options.tmpDir,
      cache: options.cache
    });

    const paths = getPipelinePaths(options.tmpDir, story.id);
    const captions = await generateSubtitles({
      audioPath: voiceover.outputPath,
      outputPath: paths.captionsPath,
      cache: options.cache
    });

    logger.stage('subtitles', `Mapped ${captions.words.length} caption words`);
    requireImageEnv(options);

    const composed = await composeRemotionProps(story, {
      tmpDir: options.tmpDir,
      brollDir: options.brollDir,
      cache: options.cache,
      fps: options.fps,
      width: options.width,
      height: options.height,
      useImageGen: options.imagegen,
      imageProvider: options.provider,
      imageQuality: options.imageQuality,
      shotsPerSegment: options.shotsPerSegment,
      audioPath: voiceover.outputPath,
      captionsPath: paths.captionsPath,
      manifestPath: voiceover.manifestPath
    });

    await renderVideo({
      propsPath: composed.propsPath,
      outputPath: options.output,
      cache: options.cache
    });
  })
);

program
  .command('voiceover')
  .description('Generate voiceover audio with the configured TTS provider')
  .requiredOption('--script <file>', 'Story script JSON or TypeScript file')
  .option('--tmp-dir <dir>', 'Directory for pipeline state', 'tmp')
  .option('--no-cache', 'Regenerate voiceover even when cache files exist')
  .action((options: {script: string; tmpDir: string; cache?: boolean}) =>
    runCommand('voiceover', async () => {
      const story = await loadStoryScript(options.script, {tmpDir: options.tmpDir});
      requireVoiceEnv(story);
      await generateVoiceover(story, {
        tmpDir: options.tmpDir,
        cache: options.cache
      });
    })
  );

program
  .command('subtitles')
  .description('Generate Whisper word-level captions for an audio file')
  .requiredOption('--audio <file>', 'Voiceover MP3 file')
  .option('--output <file>', 'Caption JSON output path')
  .option('--no-cache', 'Regenerate captions even when cache files exist')
  .action((options: {audio: string; output?: string; cache?: boolean}) =>
    runCommand('subtitles', async () => {
      requireEnv(['OPENAI_API_KEY'], 'Subtitles');
      await generateSubtitles({
        audioPath: options.audio,
        outputPath: options.output,
        cache: options.cache
      });
    })
  );

addCommonOptions(
  program
    .command('compose')
    .description('Generate Remotion input props from cached pipeline state')
    .requiredOption('--script <file>', 'Story script JSON or TypeScript file')
).action((options: CommonOptions & {script: string}) =>
  runCommand('compose', async () => {
    const story = await loadStoryScript(options.script, {tmpDir: options.tmpDir});
    const paths = getPipelinePaths(options.tmpDir, story.id);
    requireImageEnv(options);
    await composeRemotionProps(story, {
      tmpDir: options.tmpDir,
      brollDir: options.brollDir,
      cache: options.cache,
      fps: options.fps,
      width: options.width,
      height: options.height,
      useImageGen: options.imagegen,
      imageProvider: options.provider,
      imageQuality: options.imageQuality,
      shotsPerSegment: options.shotsPerSegment,
      audioPath: paths.audioPath,
      captionsPath: paths.captionsPath,
      manifestPath: paths.voiceManifestPath
    });
  })
);

addCommonOptions(
  program
    .command('render')
    .description('Compose and render using cached or newly generated stage output')
    .requiredOption('--script <file>', 'Story script JSON or TypeScript file')
    .option('--output <file>', 'Rendered MP4 output path', './out/plotpipe.mp4')
    .option('--skip-voiceover', 'Use cached voiceover instead of calling the TTS provider')
    .option('--skip-subtitles', 'Use cached captions instead of calling OpenAI')
).action(
  (
    options: CommonOptions & {
      script: string;
      output: string;
      skipVoiceover?: boolean;
      skipSubtitles?: boolean;
    }
  ) =>
    runCommand('render', async () => {
      const story = await loadStoryScript(options.script, {tmpDir: options.tmpDir});
      const paths = getPipelinePaths(options.tmpDir, story.id);
      let audioPath = paths.audioPath;
      let manifestPath = paths.voiceManifestPath;

      if (options.skipVoiceover) {
        if (!(await exists(audioPath))) {
          throw new Error(`--skip-voiceover requested, but cached audio is missing: ${audioPath}`);
        }
      } else {
        requireVoiceEnv(story);
        const voiceover = await generateVoiceover(story, {
          tmpDir: options.tmpDir,
          cache: options.cache
        });
        audioPath = voiceover.outputPath;
        manifestPath = voiceover.manifestPath;
      }

      if (options.skipSubtitles) {
        if (!(await exists(paths.captionsPath))) {
          throw new Error(`--skip-subtitles requested, but cached captions are missing: ${paths.captionsPath}`);
        }
      } else {
        requireEnv(['OPENAI_API_KEY'], 'Subtitles');
        await generateSubtitles({
          audioPath,
          outputPath: paths.captionsPath,
          cache: options.cache
        });
      }

      requireImageEnv(options);

      const composed = await composeRemotionProps(story, {
        tmpDir: options.tmpDir,
        brollDir: options.brollDir,
        cache: options.cache,
        fps: options.fps,
        width: options.width,
        height: options.height,
        useImageGen: options.imagegen,
        imageProvider: options.provider,
        imageQuality: options.imageQuality,
        shotsPerSegment: options.shotsPerSegment,
        audioPath,
        captionsPath: paths.captionsPath,
        manifestPath
      });

      await renderVideo({
        propsPath: composed.propsPath,
        outputPath: options.output,
        cache: options.cache
      });
    })
);

program.parseAsync(process.argv);
