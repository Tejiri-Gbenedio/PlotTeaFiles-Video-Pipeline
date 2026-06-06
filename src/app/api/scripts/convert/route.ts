import {NextResponse} from 'next/server';
import {z} from 'zod';
import {StudioStoryScriptSchema} from '../../jobs/schema';

const ConvertRequestSchema = z.object({
  plainScript: z.string().min(40),
  title: z.string().min(1).optional(),
  targetSegments: z.number().int().min(3).max(8).optional(),
  tone: z.string().min(1).optional()
});

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function safeId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || `story-${Date.now()}`
  );
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fn();
    } catch (caught) {
      lastError = caught;

      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** (attempt - 1)));
      }
    }
  }

  throw new Error(
    `${label} failed after 3 attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

function buildPrompt(input: z.infer<typeof ConvertRequestSchema>): string {
  return [
    'Convert this pasted storytelling script into the internal PlotTeaFiles StoryScript JSON format.',
    '',
    'Required JSON shape:',
    '{',
    '  "id": "url-safe-story-id",',
    '  "title": "short title",',
    '  "hook": "strong opening hook shown on screen",',
    '  "segments": [',
    '    {',
    '      "narration": "spoken narration for this scene",',
    '      "broll_keyword": "concrete visual mood keyword, 2-5 words",',
    '      "effect": "ken_burns"',
    '    }',
    '  ],',
    '  "outro": "short closing line"',
    '}',
    '',
    'Rules:',
    `- Create ${input.targetSegments ?? 5} segments unless the script strongly needs fewer or more.`,
    '- Keep narration text natural and close to the original script.',
    '- Segment narration should be cinematic chunks, not single sentences when the story is long.',
    '- Create a punchy hook from the most suspenseful part of the script.',
    '- broll_keyword must describe what the scene LOOKS like, not an abstract meaning.',
    '- Effects must be one of: ken_burns, camera_shake, zoom_in, static.',
    '- Use camera_shake only for intense impact/disaster moments.',
    '- Do not invent unrelated facts, names, locations, or outcomes.',
    '- Return only valid JSON. No markdown. No commentary.',
    '',
    input.title ? `Creator supplied title: ${input.title}` : 'Creator supplied title: none',
    `Tone: ${input.tone ?? 'cinematic suspenseful PlotTeaFiles narration'}`,
    '',
    'Plain script:',
    input.plainScript
  ].join('\n');
}

function parseModelJson(content: string): unknown {
  const trimmed = content.trim();
  const unwrapped = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  return JSON.parse(unwrapped) as unknown;
}

export async function POST(request: Request) {
  try {
    const input = ConvertRequestSchema.parse(await request.json());
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {error: 'Plain Script Mode requires OPENAI_API_KEY on the server.'},
        {status: 500}
      );
    }

    const model = process.env.OPENAI_SCRIPT_MODEL ?? 'gpt-4o-mini';
    const prompt = buildPrompt(input);

    const story = await withRetry('Plain script conversion', async () => {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          temperature: 0.35,
          response_format: {type: 'json_object'},
          messages: [
            {
              role: 'system',
              content:
                'You are a PlotTeaFiles story producer. You convert plain creator scripts into validated JSON for a cinematic short-form video pipeline.'
            },
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI returned ${response.status}: ${body.slice(0, 300)}`);
      }

      const data = (await response.json()) as OpenAiChatResponse;
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('OpenAI returned empty conversion content');
      }

      const parsed = StudioStoryScriptSchema.parse(parseModelJson(content));

      return {
        ...parsed,
        id: safeId(parsed.id || parsed.title)
      };
    });

    return NextResponse.json({story});
  } catch (caught) {
    if (caught instanceof z.ZodError) {
      return NextResponse.json(
        {error: caught.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')},
        {status: 400}
      );
    }

    return NextResponse.json(
      {error: caught instanceof Error ? caught.message : String(caught)},
      {status: 500}
    );
  }
}
