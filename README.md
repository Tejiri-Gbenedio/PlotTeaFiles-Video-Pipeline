# PlotPipe

`plotpipe` is a Node.js 18+ CLI that turns a PlotTeaFiles story script into a rendered short-form video. It validates a story script, generates voiceover audio with OpenAI TTS by default, transcribes word-level captions with OpenAI Whisper, composes Remotion props, and renders an MP4.

## Setup

```bash
npm install
cp .env.example .env
npm run build
```

Add your API keys to `.env`:

```bash
TTS_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=marin
OPENAI_TTS_INSTRUCTIONS=Narrate in a cinematic, suspenseful storytelling tone with clear pacing for short-form video.
OPENAI_TRANSCRIPTION_MODEL=whisper-1
GEMINI_API_KEY=...
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image
OPENAI_IMAGE_MODEL=gpt-image-1-mini
```

To use ElevenLabs later, set `TTS_PROVIDER=elevenlabs` and provide `ELEVENLABS_API_KEY` plus `ELEVENLABS_VOICE_ID`.

You also need `ffmpeg` and `ffprobe` available on `PATH`.

## Usage

```bash
# Full pipeline
plotpipe run --script ./scripts/sample-story.json --output ./out/tornado.mp4

# During development
npm run dev -- run --script ./scripts/sample-story.json --output ./out/tornado.mp4

# Individual stages
plotpipe voiceover --script ./scripts/sample-story.json
plotpipe subtitles --audio ./tmp/sample-tornado-survivor/voiceover.mp3
plotpipe render --script ./scripts/sample-story.json --skip-voiceover
```

Stage outputs are cached under `tmp/<story-id>/`. Use `--no-cache` on any command to regenerate existing outputs.

## PlotTeaFiles Studio

The Phase 3 Studio is a Next.js web app for pasting scripts, submitting render jobs, tracking progress, and downloading MP4s.

```bash
npm run web:dev
```

Open `http://localhost:3000`.

Runner modes:

```bash
STUDIO_RUNNER_MODE=mock    # UI/job flow only, no real render
STUDIO_RUNNER_MODE=local   # runs the local PlotPipe CLI from the API route
STUDIO_RUNNER_MODE=remote  # sends jobs to RENDER_WORKER_URL
```

For Vercel, use `mock` or `remote`. Do not run heavy Remotion renders inside a normal Vercel request. Keep private keys in Vercel environment variables and never expose them with `NEXT_PUBLIC_`.

## B-Roll

Place local B-roll in `assets/broll/`. The compose stage matches each segment's `broll_keyword` against image or video filenames and copies matched assets into `public/plotpipe/<story-id>/` so Remotion can render them with `staticFile()`.

If no local B-roll matches, PlotPipe generates story-specific cinematic images from each segment's narration. Gemini is the default provider using `gemini-2.5-flash-image`; if Gemini is unavailable or fails, PlotPipe falls back to OpenAI image generation with `gpt-image-1-mini`.

Generated images are cached in `tmp/<story-id>/generated/` and copied into `public/plotpipe/<story-id>/broll/` for Remotion. Prompt files are saved beside the generated images so you can inspect or tune the creative direction. By default, PlotPipe generates 3 shots per segment and cuts between them with slow cinematic motion.

Supported image extensions: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`.

Supported video extensions: `.mp4`, `.mov`, `.webm`, `.mkv`.

If no matching local asset exists and image generation is disabled, the renderer uses a generated keyword background so the pipeline still completes. Use `--provider openai` to force OpenAI image generation, `--image-quality medium` or `--image-quality high` for better OpenAI fallback images, or `--no-imagegen` to force local assets/placeholders only.

## Script Format

JSON scripts and TypeScript data files are supported. TypeScript files should export the object as `default`, `story`, `script`, or `storyScript`.

```ts
interface StoryScript {
  id: string;
  title: string;
  hook: string;
  segments: {
    narration: string;
    broll_keyword: string;
    broll_queries?: string[];
    effect?: 'ken_burns' | 'camera_shake' | 'zoom_in' | 'static';
  }[];
  outro?: string;
  voice_id?: string; // used when TTS_PROVIDER=elevenlabs
}
```

## Commands

```bash
plotpipe run --script <file> --output <mp4>
plotpipe voiceover --script <file>
plotpipe subtitles --audio <mp3> [--output <json>]
plotpipe compose --script <file>
plotpipe render --script <file> --output <mp4> [--skip-voiceover] [--skip-subtitles]
```

Common options:

```bash
--tmp-dir <dir>       Default: tmp
--broll-dir <dir>     Default: assets/broll
--fps <number>        Default: 30
--width <number>      Default: 1080
--height <number>     Default: 1920
--provider <provider> gemini or openai
--image-quality <q>   OpenAI quality: low, medium, or high
--shots-per-segment <n> Generated B-roll images per segment, default 3
--no-imagegen         Disable AI image generation
--no-cache            Regenerate existing stage outputs
```

## Remotion

The Remotion entry is `src/remotion/Root.tsx`, and the composition id is `PlotPipeStory`. The generated props JSON is written to `tmp/<story-id>/remotion-props.json`.
