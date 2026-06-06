import {createWriteStream, promises as fs} from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import fetch from 'node-fetch';
import {logger} from '../utils/logger.js';
import {HttpRequestError, withRetry} from '../utils/retry.js';
import {safeFileName} from './paths.js';

// Deprecated: PlotPipe now uses src/pipeline/imagegen.ts for generated story B-roll.
// This module is kept for reference and possible future stock-footage workflows.

type PexelsOrientation = 'landscape' | 'portrait' | 'square';
type PexelsMediaType = 'video' | 'image';
export type PexelsMediaPreference = 'auto' | 'video' | 'image';

export interface PexelsOptions {
  apiKey?: string;
  cacheDir: string;
  cache?: boolean;
  orientation?: PexelsOrientation;
  perPage?: number;
  narration?: string;
  manualQueries?: string[];
  useLlmKeywords?: boolean;
  openAiApiKey?: string;
  openAiModel?: string;
  mediaPreference?: PexelsMediaPreference;
}

export interface PexelsMediaResult {
  type: PexelsMediaType;
  keyword: string;
  filePath: string;
  sourceUrl: string;
  searchQuery: string;
  refinedQueries: string[];
  photographer?: string;
  photographerUrl?: string;
}

interface PexelsVideoFile {
  id: number;
  quality?: string;
  file_type?: string;
  width?: number;
  height?: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  url: string;
  image?: string;
  duration?: number;
  user?: {
    name?: string;
    url?: string;
  };
  video_files?: PexelsVideoFile[];
}

interface PexelsVideoResponse {
  videos?: PexelsVideo[];
}

interface PexelsPhoto {
  id: number;
  url: string;
  photographer?: string;
  photographer_url?: string;
  src?: {
    original?: string;
    large2x?: string;
    portrait?: string;
    large?: string;
  };
}

interface PexelsPhotoResponse {
  photos?: PexelsPhoto[];
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function mediaCachePath(cacheDir: string, keyword: string, extension: string): string {
  return path.join(cacheDir, `${safeFileName(keyword)}${extension}`);
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

function uniqueQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const query of queries.map(normalizeQuery).filter(Boolean)) {
    const key = query.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(query);
    }
  }

  return result;
}

function getExtensionFromUrl(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname;
    const extension = path.extname(pathname).toLowerCase();
    return extension || fallback;
  } catch {
    return fallback;
  }
}

async function requestJson<T>(url: URL, apiKey: string, label: string): Promise<T> {
  return withRetry(label, async () => {
    const response = await fetch(url, {
      headers: {
        Authorization: apiKey
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new HttpRequestError(
        `Pexels returned ${response.status} ${response.statusText}`,
        response.status,
        body
      );
    }

    return (await response.json()) as T;
  });
}

function parseOpenAiJsonArray(content: string): string[] {
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('OpenAI keyword response was not a JSON array');
  }

  return parsed
    .map((item) => (typeof item === 'string' ? normalizeQuery(item) : ''))
    .filter(Boolean)
    .slice(0, 3);
}

export async function refineBRollKeywords(
  narration: string,
  keyword: string,
  options: Pick<PexelsOptions, 'openAiApiKey' | 'openAiModel'> = {}
): Promise<string[]> {
  const apiKey = options.openAiApiKey ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY for Pexels keyword refinement');
  }

  const model = options.openAiModel ?? process.env.OPENAI_BROLL_KEYWORD_MODEL ?? 'gpt-4o-mini';
  const systemPrompt = [
    'You are a stock footage search expert. Given a story narration and a rough keyword, generate 3 alternative Pexels search queries that would return visually relevant stock footage.',
    'Rules:',
    'Use concrete visual descriptions, not abstract concepts',
    'Think about what the scene LOOKS like, not what it MEANS',
    'Prefer 2-3 word queries (Pexels works best with short queries)',
    'Avoid compound concepts that confuse search (e.g. "family hallway closet" -> "dark hallway" or "woman hiding room")',
    'Return ONLY a JSON array of 3 strings, nothing else'
  ].join('\n');

  return withRetry(`OpenAI B-roll keyword refinement for "${keyword}"`, async () => {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: [
              `Narration: ${narration}`,
              `Keyword: ${keyword}`
            ].join('\n')
          }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new HttpRequestError(
        `OpenAI keyword refinement returned ${response.status} ${response.statusText}`,
        response.status,
        body
      );
    }

    const data = (await response.json()) as OpenAiChatResponse;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('OpenAI keyword refinement returned empty content');
    }

    return parseOpenAiJsonArray(content);
  });
}

async function resolveSearchQueries(keyword: string, options: PexelsOptions): Promise<string[]> {
  if (options.manualQueries?.length) {
    return uniqueQueries([...options.manualQueries, keyword]);
  }

  if (options.useLlmKeywords === false || !options.narration) {
    return uniqueQueries([keyword]);
  }

  try {
    const refined = await refineBRollKeywords(options.narration, keyword, {
      openAiApiKey: options.openAiApiKey,
      openAiModel: options.openAiModel
    });
    const queries = uniqueQueries([...refined, keyword]);
    logger.stage('pexels', `Refined "${keyword}" -> ${queries.map((query) => `"${query}"`).join(', ')}`);
    return queries;
  } catch (error) {
    logger.warn(
      `Keyword refinement failed for "${keyword}"; using original keyword (${error instanceof Error ? error.message : String(error)})`
    );
    return uniqueQueries([keyword]);
  }
}

function scoreVideoFile(file: PexelsVideoFile): number {
  const width = file.width ?? 0;
  const height = file.height ?? 0;
  const area = width * height;
  const portraitBonus = height >= width ? 2_000_000 : 0;
  const targetArea = 1080 * 1920;
  const areaPenalty = Math.abs(area - targetArea) / 10;
  const qualityBonus = file.quality === 'hd' ? 100_000 : file.quality === 'uhd' ? 80_000 : 0;

  return area + portraitBonus + qualityBonus - areaPenalty;
}

function hasReasonableResolution(file: PexelsVideoFile, orientation: PexelsOrientation): boolean {
  const width = file.width ?? 0;
  const height = file.height ?? 0;

  if (!width || !height) {
    return false;
  }

  if (orientation === 'portrait') {
    return height >= 1080 && width >= 540;
  }

  if (orientation === 'landscape') {
    return width >= 1080 && height >= 540;
  }

  return width >= 720 && height >= 720;
}

function pickVideoFile(video: PexelsVideo, orientation: PexelsOrientation): PexelsVideoFile | undefined {
  return (video.video_files ?? [])
    .filter(
      (file) =>
        file.link &&
        (file.file_type ?? '').toLowerCase().includes('mp4') &&
        hasReasonableResolution(file, orientation)
    )
    .sort((a, b) => scoreVideoFile(b) - scoreVideoFile(a))[0];
}

async function searchPexelsVideo(
  keyword: string,
  apiKey: string,
  options: PexelsOptions
): Promise<{video: PexelsVideo; file: PexelsVideoFile} | undefined> {
  const url = new URL('https://api.pexels.com/v1/videos/search');
  url.searchParams.set('query', keyword);
  url.searchParams.set('orientation', options.orientation ?? 'portrait');
  url.searchParams.set('size', 'medium');
  url.searchParams.set('per_page', String(options.perPage ?? 8));

  const response = await requestJson<PexelsVideoResponse>(
    url,
    apiKey,
    `Pexels video search for "${keyword}"`
  );

  const orientation = options.orientation ?? 'portrait';

  for (const video of response.videos ?? []) {
    const file = pickVideoFile(video, orientation);
    if (file) {
      return {video, file};
    }
  }

  return undefined;
}

async function searchPexelsVideos(
  queries: string[],
  apiKey: string,
  options: PexelsOptions
): Promise<{query: string; video: PexelsVideo; file: PexelsVideoFile} | undefined> {
  for (const query of queries) {
    const video = await searchPexelsVideo(query, apiKey, options);
    if (video) {
      return {
        query,
        ...video
      };
    }
  }

  return undefined;
}

async function searchPexelsPhoto(
  keyword: string,
  apiKey: string,
  options: PexelsOptions
): Promise<PexelsPhoto | undefined> {
  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', keyword);
  url.searchParams.set('orientation', options.orientation ?? 'portrait');
  url.searchParams.set('size', 'medium');
  url.searchParams.set('per_page', String(options.perPage ?? 8));

  const response = await requestJson<PexelsPhotoResponse>(
    url,
    apiKey,
    `Pexels photo search for "${keyword}"`
  );

  return response.photos?.find((photo) => photo.src?.portrait ?? photo.src?.large2x ?? photo.src?.large);
}

async function searchPexelsPhotos(
  queries: string[],
  apiKey: string,
  options: PexelsOptions
): Promise<{query: string; photo: PexelsPhoto} | undefined> {
  for (const query of queries) {
    const photo = await searchPexelsPhoto(query, apiKey, options);
    if (photo) {
      return {
        query,
        photo
      };
    }
  }

  return undefined;
}

async function downloadFile(url: string, outputPath: string, apiKey?: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), {recursive: true});

  await withRetry(`Pexels download ${path.basename(outputPath)}`, async () => {
    const response = await fetch(url, {
      headers: apiKey
        ? {
            Authorization: apiKey
          }
        : undefined
    });

    if (!response.ok || !response.body) {
      const body = await response.text();
      throw new HttpRequestError(
        `Pexels asset download returned ${response.status} ${response.statusText}`,
        response.status,
        body
      );
    }

    await pipeline(response.body, createWriteStream(outputPath));
  });
}

export async function fetchPexelsMedia(
  keyword: string,
  options: PexelsOptions
): Promise<PexelsMediaResult | undefined> {
  const apiKey = options.apiKey ?? process.env.PEXELS_API_KEY;

  if (!apiKey) {
    return undefined;
  }

  await fs.mkdir(options.cacheDir, {recursive: true});
  const queries = await resolveSearchQueries(keyword, options);
  const cacheKey = queries[0] ?? keyword;

  const cachedVideo = mediaCachePath(options.cacheDir, cacheKey, '.mp4');
  if (options.cache !== false && (await exists(cachedVideo))) {
    logger.stage('pexels', `Using cached video for "${cacheKey}"`);
    return {
      type: 'video',
      keyword,
      filePath: cachedVideo,
      sourceUrl: 'cached',
      searchQuery: cacheKey,
      refinedQueries: queries
    };
  }

  const mediaPreference = options.mediaPreference ?? 'auto';
  const shouldSearchVideos = mediaPreference === 'auto' || mediaPreference === 'video';
  const shouldSearchImages = mediaPreference === 'auto' || mediaPreference === 'image';

  const video = shouldSearchVideos ? await searchPexelsVideos(queries, apiKey, options) : undefined;
  if (video) {
    const outputPath = mediaCachePath(options.cacheDir, video.query, '.mp4');
    logger.stage('pexels', `Downloading video for "${video.query}"`);
    await downloadFile(video.file.link, outputPath);
    return {
      type: 'video',
      keyword,
      filePath: outputPath,
      sourceUrl: video.video.url,
      searchQuery: video.query,
      refinedQueries: queries,
      photographer: video.video.user?.name,
      photographerUrl: video.video.user?.url
    };
  }

  if (!shouldSearchImages) {
    logger.warn(`No Pexels video found for "${keyword}" using ${queries.join(', ')}`);
    return undefined;
  }

  const cachedImage = mediaCachePath(options.cacheDir, cacheKey, '.jpg');
  if (options.cache !== false && (await exists(cachedImage))) {
    logger.stage('pexels', `Using cached image for "${cacheKey}"`);
    return {
      type: 'image',
      keyword,
      filePath: cachedImage,
      sourceUrl: 'cached',
      searchQuery: cacheKey,
      refinedQueries: queries
    };
  }

  const photoResult = await searchPexelsPhotos(queries, apiKey, options);
  const photo = photoResult?.photo;
  const photoUrl = photo?.src?.portrait ?? photo?.src?.large2x ?? photo?.src?.large;

  if (!photoResult || !photo || !photoUrl) {
    logger.warn(`No Pexels media found for "${keyword}" using ${queries.join(', ')}`);
    return undefined;
  }

  const outputPath = mediaCachePath(
    options.cacheDir,
    photoResult.query,
    getExtensionFromUrl(photoUrl, '.jpg')
  );
  logger.stage('pexels', `Downloading image for "${photoResult.query}"`);
  await downloadFile(photoUrl, outputPath);

  return {
    type: 'image',
    keyword,
    filePath: outputPath,
    sourceUrl: photo.url,
    searchQuery: photoResult.query,
    refinedQueries: queries,
    photographer: photo.photographer,
    photographerUrl: photo.photographer_url
  };
}
