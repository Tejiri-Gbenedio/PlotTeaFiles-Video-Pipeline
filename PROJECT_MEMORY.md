# PlotPipe Project Memory

Last updated: June 6, 2026

## What We Built

PlotPipe is a Node.js/TypeScript CLI for the PlotTeaFiles storytelling video pipeline. It takes a story script, generates narration audio, creates word-level captions, builds Remotion props, and renders a YouTube Shorts-style MP4.

Core pipeline stages:

- Parse story JSON/TypeScript with Zod validation.
- Generate voiceover with OpenAI TTS by default.
- Generate word-level captions with OpenAI Whisper.
- Compose Remotion scenes with audio, captions, B-roll, motion, vignette, and hook screen.
- Render final MP4 with Remotion.

Main project files:

- `src/cli.ts` - CLI commands and flags.
- `src/pipeline/parse.ts` - Story schema and validation.
- `src/pipeline/voiceover.ts` - TTS integration.
- `src/pipeline/subtitles.ts` - Whisper transcription.
- `src/pipeline/compose.ts` - Converts pipeline state into Remotion props.
- `src/pipeline/imagegen.ts` - AI image generation B-roll system.
- `src/pipeline/pexels.ts` - Deprecated Pexels stock-footage system.
- `src/remotion/StoryComposition.tsx` - Main Remotion composition.
- `src/remotion/components/BRoll.tsx` - B-roll rendering, motion, cuts, and cinematic overlays.
- `scripts/sample-story.json` - Tornado survivor sample story.
- `.env.example` - Template env vars.

## Major Progress

1. Initial CLI pipeline was built end to end.
2. ElevenLabs TTS failed with `402 Payment Required`, so the pipeline was switched to OpenAI TTS.
3. OpenAI TTS + Whisper + Remotion worked and produced a complete video with audio/captions.
4. Pexels B-roll was added, but quality was weak because stock footage did not match narrative scenes well.
5. We added LLM keyword refinement and multi-query Pexels search, but Pexels still felt generic.
6. We tested all-photo Pexels output, but it was still too stock-like/static.
7. We replaced Pexels as the main source with AI-generated images using Gemini primary and OpenAI fallback.
8. Gemini key was added, but Gemini image generation returned `429 Too Many Requests`.
9. OpenAI image generation fallback produced the best visuals so far.
10. We upgraded the pipeline to generate multiple AI images per scene and animate/cut between them.

## Outputs Produced

Generated videos so far:

- `out/tornado.mp4` - Original placeholder-style render.
- `out/tornado-pexels.mp4` - First Pexels video render.
- `out/tornado-pexels-v2.mp4` - Pexels render with better keyword refinement.
- `out/tornado-pexels-photos.mp4` - Pexels photo-only comparison.
- `out/tornado-ai.mp4` - AI-image render using OpenAI fallback.
- `out/tornado-gemini.mp4` - Command used Gemini provider, but actual images came from OpenAI fallback due to Gemini `429`.
- `out/tornado-ai-cinematic.mp4` - Best approach so far: OpenAI AI images, 3 shots per segment, cinematic prompts and motion.

Ratings we gave earlier:

- `tornado.mp4`: 2/10
- `tornado-pexels.mp4`: 4/10
- `tornado-pexels-v2.mp4`: 5/10
- `tornado-pexels-photos.mp4`: 4/10

Best current result:

- `out/tornado-ai-cinematic.mp4`

## Important Lessons

Pexels was not a good fit for this channel style. The story needs specific dramatic moments, and stock footage tends to return generic or mismatched visuals. Even with better search prompts, it could not reliably create a coherent emotional sequence.

The best approach so far is AI-generated visual storytelling:

- Use narration as the source of truth.
- Generate multiple cinematic stills per segment.
- Cut between those stills so no image is dragged too long.
- Animate each still with slow zoom, drift, fade, grain, vignette, and cinematic overlays.
- Keep captions and audio from the existing pipeline.

## Provider Notes

OpenAI image generation produced the best usable result so far.

Gemini is wired into the pipeline, and `GEMINI_API_KEY` is checked from `.env`, but the test run failed with:

```text
Gemini returned 429 Too Many Requests
```

Because of that, `tornado-gemini.mp4` was actually generated with OpenAI fallback:

```text
openai / gpt-image-1-mini
```

Do not print `.env` contents or API keys. It is fine to check whether keys are present without revealing values.

Important GitHub safety rule from the user:

- Never commit or push `.env`.
- Never commit or push API keys.
- Only `.env.example` is safe to commit.
- Keep generated outputs, caches, and real secrets out of GitHub.

## Current Best Command

Use this for the best current rendering approach:

```powershell
npx tsx src/cli.ts render --script ./scripts/sample-story.json --output ./out/tornado-ai-cinematic.mp4 --skip-voiceover --skip-subtitles --provider openai --image-quality low --shots-per-segment 3
```

Use `--no-cache` only when intentionally regenerating images, because image generation costs money/API calls.

## Current Architecture Decision

Pexels is deprecated but kept in the repo for reference. The active B-roll strategy is:

1. Try local assets in `assets/broll`.
2. If no local asset matches, generate AI images in `tmp/<story-id>/generated/`.
3. Copy images into `public/plotpipe/<story-id>/broll/`.
4. Render them as Remotion image shots with cinematic motion.
5. Fall back to placeholder visuals only if image generation is disabled or unavailable.

## Recent Code Changes

Added:

- `src/pipeline/imagegen.ts`
- `PROJECT_MEMORY.md`

Modified:

- `src/pipeline/compose.ts`
- `src/cli.ts`
- `src/remotion/types.ts`
- `src/remotion/components/BRoll.tsx`
- `.env.example`
- `README.md`
- `src/pipeline/pexels.ts` with a deprecation comment

New CLI flags:

- `--provider gemini|openai`
- `--image-quality low|medium|high`
- `--shots-per-segment <number>`
- `--no-imagegen`

Deprecated old Pexels flags from the main workflow:

- `--broll-media`
- `--no-pexels`
- `--no-llm-keywords`

## Current Challenges

1. Gemini image generation is rate-limited or quota-limited.
2. OpenAI image generation works but costs per image.
3. More generated shots improve pacing but increase render time and API usage.
4. The cinematic Remotion overlays improved feel but made rendering slower.
5. Next quality gains should come from prompt/storyboard tuning, not another stock-footage provider.

## Recommended Next Steps

1. Review `out/tornado-ai-cinematic.mp4` carefully.
2. Identify which scenes still feel off.
3. Tune the generated image prompts per segment or add manual storyboard fields.
4. Consider 4 shots per segment only if 3 still feels too slow.
5. Add a preview/debug command to inspect generated images before rendering the full video.
6. Improve caption polish if needed after visuals are stronger.
7. Optionally add smarter Gemini retry behavior for `429` with longer waits, but OpenAI is currently the safer provider.
