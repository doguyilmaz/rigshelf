/** Reads a stream into memory, cancelling it and throwing `tooLarge()` once more than `limit` bytes arrive. */
export async function readBounded(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  tooLarge: () => Error,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (let part = await reader.read(); !part.done; part = await reader.read()) {
      size += part.value.byteLength;
      if (size > limit) throw tooLarge();
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, size);
}
