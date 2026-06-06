import {createReadStream, promises as fs} from 'node:fs';
import path from 'node:path';
import FormData from 'form-data';
import fetch from 'node-fetch';
import {probeAudioDuration} from '../utils/audio.js';
import {logger} from '../utils/logger.js';
import {HttpRequestError, withRetry} from '../utils/retry.js';

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
}

export interface CaptionsJson {
  audioPath: string;
  model: string;
  text: string;
  language?: string;
  duration: number;
  words: CaptionWord[];
  segments: CaptionSegment[];
  createdAt: string;
}

export interface SubtitleOptions {
  audioPath: string;
  outputPath?: string;
  cache?: boolean;
  apiKey?: string;
  model?: string;
}

interface WhisperVerboseResponse {
  text?: string;
  language?: string;
  duration?: number;
  words?: Array<{
    word?: string;
    text?: string;
    start?: number;
    end?: number;
  }>;
  segments?: Array<{
    id?: number;
    start?: number;
    end?: number;
    text?: string;
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

function defaultOutputPath(audioPath: string): string {
  return path.join(path.dirname(path.resolve(audioPath)), 'captions.json');
}

function normalizeWords(response: WhisperVerboseResponse): CaptionWord[] {
  return (response.words ?? [])
    .map((word) => ({
      text: String(word.word ?? word.text ?? '').trim(),
      start: Number(word.start),
      end: Number(word.end)
    }))
    .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end));
}

function normalizeSegments(response: WhisperVerboseResponse): CaptionSegment[] {
  return (response.segments ?? [])
    .map((segment) => ({
      id: segment.id,
      text: String(segment.text ?? '').trim(),
      start: Number(segment.start),
      end: Number(segment.end)
    }))
    .filter((segment) => segment.text && Number.isFinite(segment.start) && Number.isFinite(segment.end));
}

async function requestWhisperTranscription(
  audioPath: string,
  apiKey: string,
  model: string
): Promise<WhisperVerboseResponse> {
  return withRetry('OpenAI Whisper transcription request', async () => {
    const form = new FormData();
    form.append('file', createReadStream(audioPath), {
      filename: path.basename(audioPath),
      contentType: 'audio/mpeg'
    });
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...form.getHeaders()
      },
      body: form
    });

    if (!response.ok) {
      const body = await response.text();
      throw new HttpRequestError(
        `OpenAI transcription returned ${response.status} ${response.statusText}`,
        response.status,
        body
      );
    }

    return (await response.json()) as WhisperVerboseResponse;
  });
}

export async function generateSubtitles(options: SubtitleOptions): Promise<CaptionsJson> {
  const audioPath = path.resolve(options.audioPath);
  const outputPath = path.resolve(options.outputPath ?? defaultOutputPath(audioPath));
  const useCache = options.cache !== false;

  if (useCache && (await exists(outputPath))) {
    logger.stage('subtitles', `Using cached captions: ${outputPath}`);
    return JSON.parse(await fs.readFile(outputPath, 'utf8')) as CaptionsJson;
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'whisper-1';

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  logger.stage('subtitles', `Transcribing ${audioPath}`);
  const response = await requestWhisperTranscription(audioPath, apiKey, model);
  const probedDuration = await probeAudioDuration(audioPath);
  const words = normalizeWords(response);

  if (words.length === 0) {
    throw new Error('Whisper response did not include word-level timestamps');
  }

  const captions: CaptionsJson = {
    audioPath,
    model,
    text: String(response.text ?? '').trim(),
    language: response.language,
    duration: Number(response.duration) || probedDuration,
    words,
    segments: normalizeSegments(response),
    createdAt: new Date().toISOString()
  };

  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await fs.writeFile(outputPath, JSON.stringify(captions, null, 2), 'utf8');
  logger.success(`Captions saved: ${outputPath}`);

  return captions;
}
