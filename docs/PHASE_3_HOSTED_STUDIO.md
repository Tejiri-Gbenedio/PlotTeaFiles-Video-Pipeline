# Phase 3 Hosted Studio Plan

The Studio web app is designed as the public front door for PlotTeaFiles video generation.

## Current MVP

- Next.js app in `src/app`.
- Paste/edit story JSON in the browser.
- Submit render jobs through `/api/jobs`.
- Track job status and progress.
- Download MP4s when a local job finishes.
- Secrets stay server-side only.

## Runner Modes

`STUDIO_RUNNER_MODE=mock`

- Good for Vercel UI previews.
- Creates jobs and marks them done without rendering.
- No API spend.

`STUDIO_RUNNER_MODE=local`

- Runs `npx tsx src/cli.ts run ...` from the Next API route.
- Useful on your own computer.
- Not recommended on Vercel because video renders are long-running.

`STUDIO_RUNNER_MODE=remote`

- Sends jobs to `RENDER_WORKER_URL`.
- This is the production direction.
- The remote worker should own ffmpeg, Remotion rendering, image generation, storage uploads, and retries.

## Secret Safety

Never commit `.env`.

Use environment variables in Vercel or the worker host:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `RENDER_WORKER_URL`
- `RENDER_WORKER_TOKEN`

Do not prefix private keys with `NEXT_PUBLIC_`.

## Recommended Production Stack

- Web app: Vercel Next.js
- Database/job state: Supabase, Neon, or Upstash
- Queue: Inngest, Trigger.dev, or Upstash QStash
- Storage: Cloudflare R2, S3, or Supabase Storage
- Renderer: Railway, Render, Fly.io, AWS, or Remotion Lambda

## Next Build Steps

1. Add persistent job storage instead of the in-memory MVP store.
2. Add authentication.
3. Add a dedicated render worker service.
4. Upload MP4s to object storage.
5. Add progress/log streaming.
6. Add script templates and storyboard controls.
