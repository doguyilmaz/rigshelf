import { readBounded } from './bounded-read';

const MAX_PLAN_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_PLAN_BYTES = 128 * 1024 * 1024;
export const MAX_PLAN_CHANGES = 10000;

export async function planFile(path: string): Promise<Buffer | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  if (file.size > MAX_PLAN_FILE_BYTES)
    throw new Error('Existing output exceeds the 16 MiB file limit.');
  return readBounded(
    file.stream(),
    MAX_PLAN_FILE_BYTES,
    () => new Error('Existing output exceeds the 16 MiB file limit.'),
  );
}
