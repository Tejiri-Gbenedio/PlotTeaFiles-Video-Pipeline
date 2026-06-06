import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {NextResponse} from 'next/server';
import {getJob} from '../../store';

function getLocalOutputPath(jobId: string, storyId: string): string {
  const safeStoryId =
    storyId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'story';

  return path.resolve('out', 'studio', `${safeStoryId}-${jobId}.mp4`);
}

export async function GET(_request: Request, context: {params: Promise<{jobId: string}>}) {
  const {jobId} = await context.params;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({error: 'Job not found'}, {status: 404});
  }

  if (job.status !== 'done') {
    return NextResponse.json({error: 'Job is not ready'}, {status: 409});
  }

  const outputPath = getLocalOutputPath(job.id, job.storyId);

  try {
    const info = await stat(outputPath);
    const stream = createReadStream(outputPath);

    return new Response(stream as unknown as BodyInit, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(info.size),
        'Content-Disposition': `attachment; filename="${path.basename(outputPath)}"`
      }
    });
  } catch {
    if (job.outputUrl && job.outputUrl !== `/api/jobs/${jobId}/download`) {
      return NextResponse.redirect(job.outputUrl);
    }

    return NextResponse.json({error: 'Output file not found'}, {status: 404});
  }
}
