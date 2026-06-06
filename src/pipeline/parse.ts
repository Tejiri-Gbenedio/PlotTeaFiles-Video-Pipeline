import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {transform} from 'esbuild';
import {z} from 'zod';
import {safeFileName} from './paths.js';

export const StoryScriptSchema = z.object({
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

export type StoryScript = z.infer<typeof StoryScriptSchema>;

export interface LoadStoryOptions {
  tmpDir?: string;
}

async function loadJsonScript(scriptPath: string): Promise<unknown> {
  const contents = await fs.readFile(scriptPath, 'utf8');
  return JSON.parse(contents) as unknown;
}

async function loadTypeScriptScript(scriptPath: string, tmpDir: string): Promise<unknown> {
  const absolutePath = path.resolve(scriptPath);
  const source = await fs.readFile(absolutePath, 'utf8');
  const compiled = await transform(source, {
    loader: 'ts',
    format: 'esm',
    target: 'node18',
    sourcemap: 'inline'
  });

  const cacheDir = path.resolve(tmpDir, '.ts-loader');
  await fs.mkdir(cacheDir, {recursive: true});

  const cacheFile = path.join(
    cacheDir,
    `${safeFileName(path.basename(scriptPath, path.extname(scriptPath)))}-${Date.now()}.mjs`
  );

  await fs.writeFile(cacheFile, compiled.code, 'utf8');

  const moduleUrl = `${pathToFileURL(cacheFile).href}?t=${Date.now()}`;
  const moduleExports = (await import(moduleUrl)) as Record<string, unknown>;
  const story =
    moduleExports.default ?? moduleExports.story ?? moduleExports.script ?? moduleExports.storyScript;

  if (!story) {
    throw new Error(
      'TypeScript story files must export a default object, story, script, or storyScript'
    );
  }

  return story;
}

export async function loadStoryScript(
  scriptPath: string,
  options: LoadStoryOptions = {}
): Promise<StoryScript> {
  const absolutePath = path.resolve(scriptPath);
  const extension = path.extname(absolutePath).toLowerCase();
  let rawScript: unknown;

  if (extension === '.json') {
    rawScript = await loadJsonScript(absolutePath);
  } else if (extension === '.ts' || extension === '.tsx' || extension === '.mts') {
    rawScript = await loadTypeScriptScript(absolutePath, options.tmpDir ?? 'tmp');
  } else {
    throw new Error(`Unsupported script extension "${extension}". Use JSON or TypeScript.`);
  }

  const parsed = StoryScriptSchema.safeParse(rawScript);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'script'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid story script: ${issues}`);
  }

  return parsed.data;
}
