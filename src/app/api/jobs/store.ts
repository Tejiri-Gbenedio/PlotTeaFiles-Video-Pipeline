import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {StudioStoryScriptSchema} from './schema';

export type StudioJobStatus = 'queued' | 'running' | 'done' | 'failed';
export type StudioImageProvider = 'openai';
export type StudioImageQuality = 'low' | 'medium' | 'high';

export interface CreateJobInput {
  script: unknown;
  options?: {
    provider?: StudioImageProvider;
    imageModel?: string;
    imageQuality?: StudioImageQuality;
    shotsPerSegment?: number;
  };
}

export interface StudioJob {
  id: string;
  title: string;
  storyId: string;
  status: StudioJobStatus;
  stage: string;
  progress: number;
  createdAt: string;
  startedAt?: string;
  outputUrl?: string;
  error?: string;
}

const jobs = new Map<string, StudioJob>();

function safeFileName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'story'
  );
}

function getRunnerMode(): 'local' | 'remote' | 'mock' {
  const configured = process.env.STUDIO_RUNNER_MODE?.toLowerCase();

  if (configured === 'local' || configured === 'remote' || configured === 'mock') {
    return configured;
  }

  return process.env.RENDER_WORKER_URL ? 'remote' : 'mock';
}

function updateJob(jobId: string, updates: Partial<StudioJob>): void {
  const job = jobs.get(jobId);

  if (!job) {
    return;
  }

  jobs.set(jobId, {
    ...job,
    ...updates
  });
}

async function runMockJob(jobId: string): Promise<void> {
  updateJob(jobId, {status: 'running', stage: 'Queued for hosted worker', progress: 12});
  await new Promise((resolve) => setTimeout(resolve, 900));
  updateJob(jobId, {stage: 'Studio shell ready - connect worker to render MP4', progress: 100, status: 'done'});
}

async function runRemoteJob(
  jobId: string,
  script: unknown,
  options: NonNullable<CreateJobInput['options']>
): Promise<void> {
  const workerUrl = process.env.RENDER_WORKER_URL;
  const workerToken = process.env.RENDER_WORKER_TOKEN;

  if (!workerUrl) {
    throw new Error('Missing RENDER_WORKER_URL for remote render mode');
  }

  updateJob(jobId, {status: 'running', stage: 'Sending job to render worker', progress: 18});

  const response = await fetch(workerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(workerToken ? {Authorization: `Bearer ${workerToken}`} : {})
    },
    body: JSON.stringify({jobId, script, options})
  });

  const data = (await response.json().catch(() => ({}))) as {outputUrl?: string; error?: string};

  if (!response.ok) {
    throw new Error(data.error ?? `Render worker returned ${response.status}`);
  }

  updateJob(jobId, {
    status: 'done',
    stage: 'Render worker finished',
    progress: 100,
    outputUrl: data.outputUrl
  });
}

async function runLocalJob(
  jobId: string,
  script: unknown,
  options: NonNullable<CreateJobInput['options']>
): Promise<void> {
  const story = StudioStoryScriptSchema.parse(script);
  const storyId = safeFileName(story.id);
  const jobDir = path.resolve('tmp', 'studio-jobs');
  const scriptPath = path.join(jobDir, `${jobId}.json`);
  const outputFileName = `${storyId}-${jobId}.mp4`;
  const outputPath = path.resolve('out', 'studio', outputFileName);

  await fs.mkdir(jobDir, {recursive: true});
  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await fs.writeFile(scriptPath, JSON.stringify(story, null, 2), 'utf8');

  updateJob(jobId, {status: 'running', stage: 'Starting local PlotPipe render', progress: 10, startedAt: new Date().toISOString()});

  const args = [
    'tsx',
    'src/cli.ts',
    'run',
    '--script',
    scriptPath,
    '--output',
    outputPath,
    '--provider',
    options.provider ?? 'openai',
    '--image-model',
    options.imageModel ?? 'gpt-image-2',
    '--image-quality',
    options.imageQuality ?? 'low',
    '--shots-per-segment',
    String(options.shotsPerSegment ?? 3)
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', args, {
      cwd: process.cwd(),
      shell: process.platform === 'win32'
    });

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(`[job:${jobId.slice(0, 8)}] ${text}`);
      if (text.includes('[voiceover]')) updateJob(jobId, {stage: 'Generating voiceover', progress: 22});
      if (text.includes('[subtitles]')) updateJob(jobId, {stage: 'Generating captions', progress: 38});
      if (text.includes('[imagegen]')) updateJob(jobId, {stage: 'Generating cinematic images', progress: 58});
      if (text.includes('[render]')) updateJob(jobId, {stage: 'Rendering MP4', progress: 78});
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stderr.write(`[job:${jobId.slice(0, 8)}] ${text}`);
      if (text.includes('failed')) {
        updateJob(jobId, {stage: text.slice(0, 140), progress: 70});
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Local render exited with code ${code}`));
    });
  });

  updateJob(jobId, {
    status: 'done',
    stage: 'Video ready',
    progress: 100,
    outputUrl: `/api/jobs/${jobId}/download`
  });
}

async function runJob(
  jobId: string,
  script: unknown,
  options: NonNullable<CreateJobInput['options']>
): Promise<void> {
  try {
    const mode = getRunnerMode();

    if (mode === 'local') {
      await runLocalJob(jobId, script, options);
    } else if (mode === 'remote') {
      await runRemoteJob(jobId, script, options);
    } else {
      await runMockJob(jobId);
    }
  } catch (caught) {
    updateJob(jobId, {
      status: 'failed',
      stage: 'Render failed',
      progress: 100,
      error: caught instanceof Error ? caught.message : String(caught)
    });
  }
}

export function listJobs(): StudioJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(jobId: string): StudioJob | undefined {
  return jobs.get(jobId);
}

export async function createJob(input: CreateJobInput): Promise<StudioJob> {
  const story = StudioStoryScriptSchema.parse(input.script);
  const jobId = randomUUID();
  const job: StudioJob = {
    id: jobId,
    title: story.title,
    storyId: story.id,
    status: 'queued',
    stage: 'Queued',
    progress: 0,
    createdAt: new Date().toISOString()
  };

  jobs.set(jobId, job);
  void runJob(jobId, story, input.options ?? {});

  return job;
}
