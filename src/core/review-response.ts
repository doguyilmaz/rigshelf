import { z } from 'zod';

const MAX_REVIEW_BYTES = 1024 * 1024;
const ReviewResponse = z.object({ response: z.string().max(50000) });
export async function readReviewResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The local model returned an empty response.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.length;
      if (total > MAX_REVIEW_BYTES) throw new Error('The local model response exceeds 1 MiB.');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return ReviewResponse.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))).response;
}
