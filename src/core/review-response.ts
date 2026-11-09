import { z } from 'zod';
import { readBounded } from './bounded-read';

const MAX_REVIEW_BYTES = 1024 * 1024;
const ReviewResponse = z.object({ response: z.string().max(50000) });
export async function readReviewResponse(response: Response): Promise<string> {
  return ReviewResponse.parse(await readModelJson(response)).response;
}
export async function readModelJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('The local model returned an empty response.');
  const body = await readBounded(
    response.body,
    MAX_REVIEW_BYTES,
    () => new Error('The local model response exceeds 1 MiB.'),
  );
  return JSON.parse(body.toString('utf8'));
}
