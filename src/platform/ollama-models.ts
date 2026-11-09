import { z } from 'zod';
import { readBounded } from '../core/bounded-read';

const MODEL_LIST_URL = 'http://127.0.0.1:11434/api/tags';
const MODEL_LIST_TIMEOUT_MS = 2500;
const MAX_MODEL_LIST_BYTES = 1024 * 1024;
const ModelsSchema = z.object({
  models: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .max(100)
          .refine(
            (name) =>
              name === name.trim() &&
              [...name].every(
                (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
              ),
          ),
        size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().default(0),
        remote_host: z.string().max(4096).optional(),
        remote_model: z.string().max(1000).optional(),
      }),
    )
    .max(1000),
});

export interface OllamaModel {
  /** The exact name to pass to the Ollama generation request. */
  name: string;
  /** Reported model bytes on disk, not an estimate of required memory. */
  sizeBytes: number;
  /** Whether the service reports an upstream model/host for this name. */
  isRemote: boolean;
}

/**
 * Lists metadata from the fixed loopback Ollama service. Never pulls or runs a model.
 * @throws An actionable error for unavailable, malformed or oversized service responses.
 * @see https://docs.ollama.com/api/tags
 */
export async function getOllamaModels(
  options: { signal?: AbortSignal } = {},
): Promise<OllamaModel[]> {
  const deadline = AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(MODEL_LIST_URL, {
      signal,
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    throw new Error('Could not reach Ollama at 127.0.0.1:11434. Start Ollama and try again.', {
      cause: error,
    });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Ollama could not list models. Check the service and try again.');
  }
  if (!response.body) throw new Error('Ollama returned an invalid model list.');
  const body = await readBounded(
    response.body,
    MAX_MODEL_LIST_BYTES,
    () => new Error('Ollama model metadata exceeds the 1 MiB limit.'),
  );
  const parsed = ModelsSchema.safeParse(parseModelJson(body));
  if (!parsed.success) throw new Error('Ollama returned an invalid model list.');
  const models = new Map<string, OllamaModel>();
  for (const item of parsed.data.models) {
    const previous = models.get(item.name);
    models.set(item.name, {
      name: item.name,
      sizeBytes: Math.max(item.size, previous?.sizeBytes || 0),
      isRemote: Boolean(item.remote_host || item.remote_model || previous?.isRemote),
    });
  }
  return [...models.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function parseModelJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error('Ollama returned an invalid model list.');
  }
}
