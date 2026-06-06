import {createWriteStream, promises as fs} from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import fetch from 'node-fetch';
import {logger} from '../utils/logger.js';
import {HttpRequestError, withRetry} from '../utils/retry.js';
import {StoryScript} from './parse.js';

export type ImageGenProvider = 'gemini' | 'openai';
export type ImageQuality = 'low' | 'medium' | 'high';

export interface ImageGenOptions {
  cacheDir: string;
  cache?: boolean;
  provider?: ImageGenProvider;
  quality?: ImageQuality;
  shotCount?: number;
  geminiApiKey?: string;
  geminiModel?: string;
  openAiApiKey?: string;
  openAiModel?: string;
}

export interface GeneratedImageResult {
  filePath: string;
  provider: ImageGenProvider;
  model: string;
  prompt: string;
  role: string;
  shotIndex: number;
}

interface GeminiResponsePart {
  text?: string;
  inlineData?: {
    mimeType?: string;
    data?: string;
  };
  inline_data?: {
    mime_type?: string;
    data?: string;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiResponsePart[];
    };
  }>;
}

interface OpenAiImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
}

const GEMINI_RATE_LIMIT_DELAY_MS = 7_000;
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1-mini';

let lastGeminiCallAt = 0;

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function respectGeminiRateLimit(): Promise<void> {
  if (lastGeminiCallAt === 0) {
    lastGeminiCallAt = Date.now();
    return;
  }

  const elapsed = Date.now() - lastGeminiCallAt;
  const waitMs = Math.max(0, GEMINI_RATE_LIMIT_DELAY_MS - elapsed);

  if (waitMs > 0) {
    logger.stage('imagegen', `Waiting ${Math.ceil(waitMs / 1000)}s for Gemini rate limit`);
    await delay(waitMs);
  }

  lastGeminiCallAt = Date.now();
}

function segmentImagePath(cacheDir: string, segmentIndex: number, shotIndex: number): string {
  return path.join(
    cacheDir,
    `segment-${String(segmentIndex + 1).padStart(2, '0')}-shot-${String(shotIndex + 1).padStart(2, '0')}.png`
  );
}

function segmentPromptPath(cacheDir: string, segmentIndex: number, shotIndex: number): string {
  return path.join(
    cacheDir,
    `segment-${String(segmentIndex + 1).padStart(2, '0')}-shot-${String(shotIndex + 1).padStart(2, '0')}.prompt.txt`
  );
}

function buildImagePrompt(
  story: StoryScript,
  segment: StoryScript['segments'][number],
  shotRole: string,
  shotIndex: number,
  shotCount: number
): string {
  return [
    'Generate a cinematic, dramatic, photorealistic image for a YouTube Shorts storytelling video.',
    `Story context: "${story.title}"`,
    `Scene narration: "${segment.narration}"`,
    `Visual mood keyword: "${segment.broll_keyword}"`,
    `Camera effect: "${segment.effect ?? 'ken_burns'}"`,
    `Shot ${shotIndex + 1} of ${shotCount}: ${shotRole}`,
    'Style requirements:',
    'Portrait orientation, vertical 9:16 composition, taller than wide',
    'Strong foreground, midground, and background depth so slow camera moves feel cinematic',
    'Compose with negative space in the lower third so captions remain readable',
    'Use a documentary thriller visual language: realistic environments, believable weather, tactile details',
    'Cinematic color grading with dark, moody tones',
    'Dramatic low-key lighting with subtle volumetric light, rain haze, dust, or storm atmosphere when appropriate',
    '35mm cinema still, shallow depth of field, realistic lens blur, film grain, high dynamic range',
    'Photorealistic but slightly stylized, like a premium true-story documentary reenactment',
    'Emotion should match the narration: suspense, fear, urgency, relief, or aftermath as appropriate',
    'Use anonymous subjects only: silhouettes, backs turned, cropped faces, or non-identifiable fictional people',
    'No text, no captions, no watermarks, no logos, no UI elements',
    'Do not include faces of real people or recognizable public figures',
    'Avoid cartoon, illustration, plastic AI skin, extra fingers, distorted bodies, and over-polished stock-photo lighting'
  ].join('\n');
}

function getShotRoles(segment: StoryScript['segments'][number], shotCount: number): string[] {
  const baseRoles = [
    `establishing shot showing the environment for "${segment.broll_keyword}"`,
    'intimate emotional detail shot, close to the action, anonymous people only',
    'cinematic reaction or aftermath shot that advances the feeling of the narration',
    'tight insert shot of tactile details like hands, debris, coats, rain, broken glass, or storm-lit walls',
    'wide dramatic transition shot that can bridge into the next scene'
  ];

  return Array.from({length: shotCount}, (_, index) => baseRoles[index % baseRoles.length]);
}

function extractGeminiImageBase64(data: GeminiResponse): string {
  const parts = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
  const imagePart = parts.find((part) => part.inlineData?.data || part.inline_data?.data);
  const imageData = imagePart?.inlineData?.data ?? imagePart?.inline_data?.data;

  if (!imageData) {
    const text = parts
      .map((part) => part.text)
      .filter(Boolean)
      .join(' ')
      .trim();
    throw new Error(text ? `Gemini returned text but no image: ${text}` : 'Gemini returned no image data');
  }

  return imageData;
}

async function saveBase64Image(base64: string, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await fs.writeFile(outputPath, Buffer.from(base64, 'base64'));
}

async function downloadImage(url: string, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), {recursive: true});

  const response = await fetch(url);

  if (!response.ok || !response.body) {
    const body = await response.text();
    throw new HttpRequestError(
      `Image download returned ${response.status} ${response.statusText}`,
      response.status,
      body
    );
  }

  await pipeline(response.body, createWriteStream(outputPath));
}

async function generateWithGemini(prompt: string, outputPath: string, options: ImageGenOptions): Promise<string> {
  const apiKey = options.geminiApiKey ?? process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const model = options.geminiModel ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  await respectGeminiRateLimit();

  await withRetry(`Gemini image generation (${model})`, async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE']
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new HttpRequestError(
        `Gemini returned ${response.status} ${response.statusText}`,
        response.status,
        body
      );
    }

    const data = (await response.json()) as GeminiResponse;
    await saveBase64Image(extractGeminiImageBase64(data), outputPath);
  });

  return model;
}

async function generateWithOpenAI(prompt: string, outputPath: string, options: ImageGenOptions): Promise<string> {
  const apiKey = options.openAiApiKey ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY for OpenAI image generation fallback');
  }

  const model = options.openAiModel ?? process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_OPENAI_IMAGE_MODEL;
  const quality = options.quality ?? 'low';

  await withRetry(`OpenAI image generation (${model})`, async () => {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size: '1024x1536',
        quality,
        output_format: 'png'
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new HttpRequestError(
        `OpenAI image generation returned ${response.status} ${response.statusText}`,
        response.status,
        body
      );
    }

    const data = (await response.json()) as OpenAiImageResponse;
    const image = data.data?.[0];

    if (image?.b64_json) {
      await saveBase64Image(image.b64_json, outputPath);
      return;
    }

    if (image?.url) {
      await downloadImage(image.url, outputPath);
      return;
    }

    throw new Error('OpenAI image generation returned no image data');
  });

  return model;
}

async function generateImage(
  prompt: string,
  outputPath: string,
  options: ImageGenOptions
): Promise<{provider: ImageGenProvider; model: string}> {
  const provider = options.provider ?? 'gemini';

  if (provider === 'openai' || !process.env.GEMINI_API_KEY) {
    const model = await generateWithOpenAI(prompt, outputPath, options);
    return {provider: 'openai', model};
  }

  try {
    const model = await generateWithGemini(prompt, outputPath, options);
    return {provider: 'gemini', model};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Gemini failed, falling back to OpenAI: ${message}`);
    const model = await generateWithOpenAI(prompt, outputPath, options);
    return {provider: 'openai', model};
  }
}

export async function generateSegmentImage(
  story: StoryScript,
  segment: StoryScript['segments'][number],
  segmentIndex: number,
  shotIndex: number,
  shotRole: string,
  shotCount: number,
  options: ImageGenOptions
): Promise<GeneratedImageResult> {
  const useCache = options.cache !== false;
  const outputPath = segmentImagePath(options.cacheDir, segmentIndex, shotIndex);
  const prompt = buildImagePrompt(story, segment, shotRole, shotIndex, shotCount);

  if (useCache && (await exists(outputPath))) {
    logger.stage('imagegen', `Using cached image: ${outputPath}`);
    return {
      filePath: outputPath,
      provider: options.provider ?? 'gemini',
      model:
        options.provider === 'openai'
          ? options.openAiModel ?? process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_OPENAI_IMAGE_MODEL
          : options.geminiModel ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_GEMINI_MODEL,
      prompt,
      role: shotRole,
      shotIndex
    };
  }

  await fs.mkdir(options.cacheDir, {recursive: true});
  await fs.writeFile(segmentPromptPath(options.cacheDir, segmentIndex, shotIndex), prompt, 'utf8');
  logger.stage(
    'imagegen',
    `Generating segment ${segmentIndex + 1} shot ${shotIndex + 1}/${shotCount} with ${options.provider ?? 'gemini'}`
  );

  const generated = await generateImage(prompt, outputPath, options);

  return {
    filePath: outputPath,
    provider: generated.provider,
    model: generated.model,
    prompt,
    role: shotRole,
    shotIndex
  };
}

export async function generateSegmentImages(
  story: StoryScript,
  segment: StoryScript['segments'][number],
  segmentIndex: number,
  options: ImageGenOptions
): Promise<GeneratedImageResult[]> {
  const shotCount = Math.max(1, Math.min(options.shotCount ?? 3, 6));
  const roles = getShotRoles(segment, shotCount);
  const results: GeneratedImageResult[] = [];

  for (let shotIndex = 0; shotIndex < shotCount; shotIndex += 1) {
    results.push(
      await generateSegmentImage(
        story,
        segment,
        segmentIndex,
        shotIndex,
        roles[shotIndex],
        shotCount,
        options
      )
    );
  }

  return results;
}
