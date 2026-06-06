import {promises as fs} from 'node:fs';
import path from 'node:path';
import {probeAudioDuration} from '../utils/audio.js';
import {logger} from '../utils/logger.js';
import {StoryRenderProps, SegmentEffect, BRollKind, CaptionRenderWord} from '../remotion/types.js';
import {StoryScript} from './parse.js';
import {generateSegmentImages, ImageGenProvider, ImageQuality} from './imagegen.js';
import {getPipelinePaths, safeFileName} from './paths.js';
import {CaptionsJson} from './subtitles.js';
import {VoiceoverManifest} from './voiceover.js';

export interface ComposeOptions {
  tmpDir?: string;
  brollDir?: string;
  publicDir?: string;
  cache?: boolean;
  fps?: number;
  width?: number;
  height?: number;
  audioPath?: string;
  captionsPath?: string;
  manifestPath?: string;
  propsPath?: string;
  useImageGen?: boolean;
  imageProvider?: ImageGenProvider;
  imageQuality?: ImageQuality;
  shotsPerSegment?: number;
}

export interface ComposeResult {
  propsPath: string;
  props: StoryRenderProps;
}

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const videoExtensions = new Set(['.mp4', '.mov', '.webm', '.mkv']);

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toStaticPath(...parts: string[]): string {
  return parts.map((part) => part.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).join('/');
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  if (!(await exists(dir))) {
    return [];
  }

  const entries = await fs.readdir(dir, {withFileTypes: true});
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(fullPath);
      }

      return [fullPath];
    })
  );

  return files.flat();
}

async function findBRollFile(keyword: string, brollDir: string): Promise<string | undefined> {
  const files = (await listFilesRecursive(path.resolve(brollDir)))
    .filter((file) => {
      const extension = path.extname(file).toLowerCase();
      return imageExtensions.has(extension) || videoExtensions.has(extension);
    })
    .sort();

  const normalizedKeyword = normalizeForMatch(keyword);
  const keywordWords = keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  return files.find((file) => {
    const basename = normalizeForMatch(path.basename(file, path.extname(file)));
    if (basename.includes(normalizedKeyword)) {
      return true;
    }

    return keywordWords.every((word) => basename.includes(word));
  });
}

function getAssetKind(filePath: string): BRollKind {
  const extension = path.extname(filePath).toLowerCase();
  if (imageExtensions.has(extension)) {
    return 'image';
  }

  if (videoExtensions.has(extension)) {
    return 'video';
  }

  return 'placeholder';
}

function getSegmentDurations(
  story: StoryScript,
  manifest: VoiceoverManifest | undefined,
  totalDurationSeconds: number
): number[] {
  const durations = story.segments.map(() => 0);

  if (manifest) {
    for (const entry of manifest.entries) {
      if (entry.segmentIndex >= 0 && entry.segmentIndex < durations.length) {
        durations[entry.segmentIndex] += entry.duration;
      }
    }
  }

  if (durations.some((duration) => duration > 0)) {
    return durations;
  }

  const totalChars =
    story.segments.reduce((sum, segment) => sum + segment.narration.length, 0) +
    (story.outro?.length ?? 0);

  if (totalChars === 0) {
    return story.segments.map(() => totalDurationSeconds / story.segments.length);
  }

  return story.segments.map((segment, index) => {
    const outroChars = index === story.segments.length - 1 ? story.outro?.length ?? 0 : 0;
    return ((segment.narration.length + outroChars) / totalChars) * totalDurationSeconds;
  });
}

function durationsToFrames(durations: number[], fps: number, totalFrames: number): number[] {
  let usedFrames = 0;

  return durations.map((duration, index) => {
    if (index === durations.length - 1) {
      return Math.max(1, totalFrames - usedFrames);
    }

    const frames = Math.max(1, Math.round(duration * fps));
    usedFrames += frames;
    return frames;
  });
}

function mapCaptionWords(words: CaptionsJson['words'], fps: number): CaptionRenderWord[] {
  return words.map((word) => {
    const startFrame = Math.max(0, Math.floor(word.start * fps));
    const endFrame = Math.max(startFrame + 1, Math.ceil(word.end * fps));

    return {
      text: word.text,
      start: word.start,
      end: word.end,
      startFrame,
      endFrame
    };
  });
}

async function copyPublicAsset(sourcePath: string, destinationPath: string): Promise<void> {
  await fs.mkdir(path.dirname(destinationPath), {recursive: true});
  await fs.copyFile(sourcePath, destinationPath);
}

export async function composeRemotionProps(
  story: StoryScript,
  options: ComposeOptions = {}
): Promise<ComposeResult> {
  const tmpDir = options.tmpDir ?? 'tmp';
  const useCache = options.cache !== false;
  const paths = getPipelinePaths(tmpDir, story.id);
  const propsPath = path.resolve(options.propsPath ?? paths.propsPath);

  if (useCache && (await exists(propsPath))) {
    logger.stage('compose', `Using cached Remotion props: ${propsPath}`);
    return {
      propsPath,
      props: JSON.parse(await fs.readFile(propsPath, 'utf8')) as StoryRenderProps
    };
  }

  const audioPath = path.resolve(options.audioPath ?? paths.audioPath);
  const captionsPath = path.resolve(options.captionsPath ?? paths.captionsPath);
  const manifestPath = path.resolve(options.manifestPath ?? paths.voiceManifestPath);
  const publicDir = path.resolve(options.publicDir ?? 'public');
  const publicStoryId = safeFileName(story.id);
  const publicStoryDir = path.join(publicDir, 'plotpipe', publicStoryId);
  const generatedCacheDir = path.join(paths.baseDir, 'generated');
  const fps = options.fps ?? 30;
  const width = options.width ?? 1080;
  const height = options.height ?? 1920;
  const useImageGen = options.useImageGen !== false;

  if (!(await exists(audioPath))) {
    throw new Error(`Missing voiceover audio: ${audioPath}`);
  }

  if (!(await exists(captionsPath))) {
    throw new Error(`Missing captions JSON: ${captionsPath}`);
  }

  const captions = JSON.parse(await fs.readFile(captionsPath, 'utf8')) as CaptionsJson;
  const manifest = (await exists(manifestPath))
    ? (JSON.parse(await fs.readFile(manifestPath, 'utf8')) as VoiceoverManifest)
    : undefined;
  const audioDuration = manifest?.duration ?? captions.duration ?? (await probeAudioDuration(audioPath));
  const durationInFrames = Math.max(1, Math.ceil(audioDuration * fps));
  const segmentDurations = getSegmentDurations(story, manifest, audioDuration);
  const segmentFrames = durationsToFrames(segmentDurations, fps, durationInFrames);

  const publicAudioPath = path.join(publicStoryDir, 'voiceover.mp3');
  await copyPublicAsset(audioPath, publicAudioPath);

  const brollDir = options.brollDir ?? 'assets/broll';
  const words = mapCaptionWords(captions.words, fps);
  let startFrame = 0;
  let startTime = 0;

  const segments: StoryRenderProps['segments'] = [];

  for (let index = 0; index < story.segments.length; index += 1) {
    const segment = story.segments[index];
    const durationFrames = segmentFrames[index];
    const durationSeconds = durationFrames / fps;
    const match = await findBRollFile(segment.broll_keyword, brollDir);
    let broll: StoryRenderProps['segments'][number]['broll'] = {
      kind: 'placeholder',
      keyword: segment.broll_keyword
    };

    if (match) {
      const extension = path.extname(match);
      const destinationName = `segment-${String(index + 1).padStart(2, '0')}${extension}`;
      const destinationPath = path.join(publicStoryDir, 'broll', destinationName);
      await copyPublicAsset(match, destinationPath);
      broll = {
        kind: getAssetKind(match),
        keyword: segment.broll_keyword,
        src: toStaticPath('plotpipe', publicStoryId, 'broll', destinationName),
        source: 'local'
      };
    } else if (useImageGen) {
      const generatedImages = await generateSegmentImages(story, segment, index, {
        cacheDir: generatedCacheDir,
        cache: useCache,
        provider: options.imageProvider ?? 'gemini',
        quality: options.imageQuality ?? 'low',
        shotCount: options.shotsPerSegment ?? 3
      });
      const shots = [];

      for (const generatedImage of generatedImages) {
        const destinationName = `segment-${String(index + 1).padStart(2, '0')}-shot-${String(generatedImage.shotIndex + 1).padStart(2, '0')}.png`;
        const destinationPath = path.join(publicStoryDir, 'broll', destinationName);
        await copyPublicAsset(generatedImage.filePath, destinationPath);
        shots.push({
          src: toStaticPath('plotpipe', publicStoryId, 'broll', destinationName),
          provider: generatedImage.provider,
          model: generatedImage.model,
          role: generatedImage.role
        });
      }

      const firstShot = shots[0];
      broll = {
        kind: 'image',
        keyword: segment.broll_keyword,
        src: firstShot?.src,
        shots,
        source: 'generated',
        provider: firstShot?.provider,
        model: firstShot?.model
      };
    }

    segments.push({
      index,
      narration: segment.narration,
      brollKeyword: segment.broll_keyword,
      effect: (segment.effect ?? 'ken_burns') as SegmentEffect,
      startTime,
      endTime: startTime + durationSeconds,
      startFrame,
      durationFrames,
      broll
    });

    startFrame += durationFrames;
    startTime += durationSeconds;
  }

  const props: StoryRenderProps = {
    id: story.id,
    title: story.title,
    hook: story.hook,
    outro: story.outro,
    fps,
    width,
    height,
    durationInFrames,
    totalDurationSeconds: audioDuration,
    hookDurationFrames: Math.min(Math.round(fps * 2.5), durationInFrames),
    audioSrc: toStaticPath('plotpipe', publicStoryId, 'voiceover.mp3'),
    words,
    segments
  };

  await fs.mkdir(path.dirname(propsPath), {recursive: true});
  await fs.writeFile(propsPath, JSON.stringify(props, null, 2), 'utf8');

  logger.success(`Remotion props saved: ${propsPath}`);

  return {propsPath, props};
}
