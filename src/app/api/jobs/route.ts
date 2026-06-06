import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {createJob, listJobs} from './store';

export async function GET() {
  return NextResponse.json({jobs: listJobs()});
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const job = await createJob(body as never);

    return NextResponse.json({job}, {status: 201});
  } catch (caught) {
    if (caught instanceof ZodError) {
      return NextResponse.json(
        {
          error: caught.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
        },
        {status: 400}
      );
    }

    return NextResponse.json(
      {error: caught instanceof Error ? caught.message : String(caught)},
      {status: 500}
    );
  }
}
