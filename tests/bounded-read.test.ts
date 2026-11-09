import { expect, test } from 'bun:test';
import { readBounded } from '../src/core/bounded-read';

function chunks(sizes: number[]) {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const size = sizes.shift();
      if (size === undefined) controller.close();
      else controller.enqueue(new Uint8Array(size).fill(65));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

test('a stream up to the limit is read whole; one byte more cancels it with the caller error', async () => {
  expect((await readBounded(chunks([4, 4]).stream, 8, () => new Error('big'))).toString()).toBe(
    'AAAAAAAA',
  );
  const over = chunks([4, 5, 100]);
  await expect(readBounded(over.stream, 8, () => new Error('too large'))).rejects.toThrow(
    'too large',
  );
  expect(over.cancelled()).toBe(true);
});
