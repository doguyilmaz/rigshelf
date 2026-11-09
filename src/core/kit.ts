import { z } from 'zod';
import { readText } from './detect';
import { MAX_PROJECT_KIT_ENTRIES } from './kit-limits';
import { McpSchema, ProviderSchema } from './model';
import { assertWritePath, hash, safeRelative } from './safety';

export const KitSchema = z.object({
  schemaVersion: z.literal(1),
  providers: z.array(ProviderSchema).max(6),
  entries: z
    .array(
      z.object({
        id: z.string().max(150),
        name: z.string().max(200).optional(),
        digest: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        ref: z.string().optional(),
      }),
    )
    .max(MAX_PROJECT_KIT_ENTRIES),
  presetId: z.string().max(100).optional(),
  requirements: z.string().max(10000).optional(),
  hashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).default({}),
  managedMcp: z.record(z.string(), z.record(z.string(), McpSchema)).optional(),
});
export type Kit = z.infer<typeof KitSchema>;
export function parseKit(text: string): Kit {
  const kit = KitSchema.parse(JSON.parse(text));
  for (const path of Object.keys(kit.hashes)) safeRelative(path);
  return kit;
}
export async function readKit(project: string): Promise<Kit | undefined> {
  const path = await assertWritePath(project, '.rigshelf/kit.json');
  const text = await readText(path, 4 * 1024 * 1024);
  return text === undefined ? undefined : parseKit(text);
}
export async function kitDrift(project: string, kit: Kit): Promise<string[]> {
  const changed: string[] = [];
  for (const [relative, expected] of Object.entries(kit.hashes)) {
    const path = await assertWritePath(project, relative);
    const file = Bun.file(path);
    if (
      !(await file.exists()) ||
      file.size > 16 * 1024 * 1024 ||
      hash(new Uint8Array(await file.arrayBuffer())) !== expected
    )
      changed.push(relative);
  }
  return changed;
}
