import {promises as fs} from 'node:fs';
import path from 'node:path';
import fetch from 'node-fetch';
import {probeAudioDuration, concatAudioFiles} from '../utils/audio.js';
import {logger} from '../utils/logger.js';
import {HttpRequestError, withRetry} from '../utils/retry.js';
import {StoryScript} from './parse.js';
import {getPipelinePaths} from './paths.js';

export interface VoiceoverEntry {
  index: number;
  kind: 'segment' | 'outro';
  segmentIndex: number;
  text: string;
  filePath: string;
  start: number;
  end: number;
  duration: number;
}

export interface VoiceoverManifest {
  storyId: string;
  outputPath: string;
  manifestPath: string;
  provider: TtsProvider;
  voiceId: string;
  modelId: string;
  duration: number;
  entries: VoiceoverEntry[];
  createdAt: string;
}

export interface VoiceoverOptions {
  tmpDir?: string;
  cache?: boolean;
  provider?: TtsProvider;
  apiKey?: string;
  voiceId?: string;
  modelId?: string;
  instructions?: string;
}

interface Utterance {
  kind: 'segment' | 'outro';
  segmentIndex: number;
  text: string;
}

export type TtsProvider = 'openai' | 'elevenlabs';

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveTtsProvider(provider?: string): TtsProvider {
  const normalized = (provider ?? process.env.TTS_PROVIDER ?? 'openai').trim().toLowerCase();

  if (normalized === 'openai' || normalized === 'elevenlabs') {
    return normalized;
  }

  throw new Error(`Unsupported TTS_PROVIDER "${provider}". Use "openai" or "elevenlabs".`);
}

async function fetchElevenLabsAudio(
  text: string,
  voiceId: string,
  apiKey: string,
  modelId: string
): Promise<Buffer> {
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`);
  url.searchParams.set('output_format', 'mp3_44100_128');

  return withRetry('ElevenLabs text-to-speech request', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0.2,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new HttpRequestError(
        `ElevenLabs returned ${response.status} ${response.statusText}`,
        response.status,
        body
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new Error('ElevenLabs returned an empty audio response');
    }

    return buffer;
  });
}

async function fetchOpenAiSpeechAudio(
  text: string,
  voiceId: string,
  apiKey: string,
  modelId: string,
  instructions?: string
): Promise<Buffer> {
  return withRetry('OpenAI text-to-speech request', async () => {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelId,
        voice: voiceId,
        input: text,
        instructions,
        response_format: 'mp3'
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new HttpRequestError(
        `OpenAI TTS returned ${response.status} ${response.statusText}`,
        response.status,
        body
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new Error('OpenAI TTS returned an empty audio response');
    }

    return buffer;
  });
}

function getUtterances(story: StoryScript): Utterance[] {
  const utterances = story.segments.map<Utterance>((segment, index) => ({
    kind: 'segment',
    segmentIndex: index,
    text: segment.narration
  }));

  if (story.outro) {
    utterances.push({
      kind: 'outro',
      segmentIndex: story.segments.length - 1,
      text: story.outro
    });
  }

  return utterances;
}

export async function generateVoiceover(
  story: StoryScript,
  options: VoiceoverOptions = {}
): Promise<VoiceoverManifest> {
  const tmpDir = options.tmpDir ?? 'tmp';
  const useCache = options.cache !== false;
  const paths = getPipelinePaths(tmpDir, story.id);

  if (useCache && (await exists(paths.audioPath)) && (await exists(paths.voiceManifestPath))) {
    logger.stage('voiceover', `Using cached voiceover: ${paths.audioPath}`);
    const cached = JSON.parse(await fs.readFile(paths.voiceManifestPath, 'utf8')) as VoiceoverManifest;
    return cached;
  }

  const provider = resolveTtsProvider(options.provider);
  const apiKey =
    options.apiKey ??
    (provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ELEVENLABS_API_KEY);
  const voiceId =
    provider === 'openai'
      ? options.voiceId ?? process.env.OPENAI_TTS_VOICE ?? 'marin'
      : story.voice_id ?? options.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
  const modelId =
    options.modelId ??
    (provider === 'openai'
      ? process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts'
      : process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2');
  const instructions =
    options.instructions ??
    process.env.OPENAI_TTS_INSTRUCTIONS ??
    'Narrate in a cinematic, suspenseful storytelling tone with clear pacing for short-form video.';

  if (!apiKey) {
    throw new Error(provider === 'openai' ? 'Missing OPENAI_API_KEY' : 'Missing ELEVENLABS_API_KEY');
  }

  if (!voiceId) {
    throw new Error('Missing ELEVENLABS_VOICE_ID or story.voice_id');
  }

  await fs.mkdir(paths.segmentsDir, {recursive: true});

  const utterances = getUtterances(story);
  const entries: VoiceoverEntry[] = [];
  let cursor = 0;

  for (let index = 0; index < utterances.length; index += 1) {
    const utterance = utterances[index];
    const segmentFile = path.join(paths.segmentsDir, `${String(index + 1).padStart(2, '0')}.mp3`);

    if (!(useCache && (await exists(segmentFile)))) {
      logger.stage(
        'voiceover',
        `Generating ${utterance.kind} audio ${index + 1}/${utterances.length} with ${provider}`
      );
      const audio =
        provider === 'openai'
          ? await fetchOpenAiSpeechAudio(utterance.text, voiceId, apiKey, modelId, instructions)
          : await fetchElevenLabsAudio(utterance.text, voiceId, apiKey, modelId);
      await fs.writeFile(segmentFile, audio);
    } else {
      logger.stage('voiceover', `Using cached segment audio ${index + 1}/${utterances.length}`);
    }

    const duration = await probeAudioDuration(segmentFile);
    entries.push({
      index,
      kind: utterance.kind,
      segmentIndex: utterance.segmentIndex,
      text: utterance.text,
      filePath: segmentFile,
      start: cursor,
      end: cursor + duration,
      duration
    });
    cursor += duration;
  }

  logger.stage('voiceover', 'Concatenating voiceover segments');
  await concatAudioFiles(
    entries.map((entry) => entry.filePath),
    paths.audioPath,
    paths.concatListPath
  );

  const duration = await probeAudioDuration(paths.audioPath);
  const manifest: VoiceoverManifest = {
    storyId: story.id,
    outputPath: paths.audioPath,
    manifestPath: paths.voiceManifestPath,
    provider,
    voiceId,
    modelId,
    duration,
    entries,
    createdAt: new Date().toISOString()
  };

  await fs.writeFile(paths.voiceManifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  logger.success(`Voiceover saved: ${paths.audioPath}`);

  return manifest;
}
