export const MAX_PLAN_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_PLAN_BYTES = 128 * 1024 * 1024;
export const MAX_PLAN_CHANGES = 10000;

export async function planFile(path: string): Promise<Buffer | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  if (file.size > MAX_PLAN_FILE_BYTES)
    throw new Error('Existing output exceeds the 16 MiB file limit.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = file.stream().getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > MAX_PLAN_FILE_BYTES)
        throw new Error('Existing output exceeds the 16 MiB file limit.');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks, total);
}
