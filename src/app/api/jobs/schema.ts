import {z} from 'zod';

export const StudioStoryScriptSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  hook: z.string().min(1),
  segments: z
    .array(
      z.object({
        narration: z.string().min(1),
        broll_keyword: z.string().min(1),
        broll_queries: z.array(z.string().min(1)).min(1).optional(),
        effect: z.enum(['ken_burns', 'camera_shake', 'zoom_in', 'static']).optional()
      })
    )
    .min(1),
  outro: z.string().min(1).optional(),
  voice_id: z.string().min(1).optional()
});

export type StudioStoryScript = z.infer<typeof StudioStoryScriptSchema>;
