import path from 'node:path';

export function safeFileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'story';
}

export interface PipelinePaths {
  storyId: string;
  baseDir: string;
  segmentsDir: string;
  audioPath: string;
  concatListPath: string;
  voiceManifestPath: string;
  captionsPath: string;
  propsPath: string;
  pexelsCreditsPath: string;
}

export function getPipelinePaths(tmpDir: string, storyId: string): PipelinePaths {
  const safeStoryId = safeFileName(storyId);
  const baseDir = path.resolve(tmpDir, safeStoryId);

  return {
    storyId: safeStoryId,
    baseDir,
    segmentsDir: path.join(baseDir, 'voiceover-segments'),
    audioPath: path.join(baseDir, 'voiceover.mp3'),
    concatListPath: path.join(baseDir, 'concat-list.txt'),
    voiceManifestPath: path.join(baseDir, 'voiceover-manifest.json'),
    captionsPath: path.join(baseDir, 'captions.json'),
    propsPath: path.join(baseDir, 'remotion-props.json'),
    pexelsCreditsPath: path.join(baseDir, 'pexels-credits.json')
  };
}
