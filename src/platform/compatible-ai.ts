import { z } from 'zod';
import { type AiConnection, AiConnectionSchema } from '../core/ai-connections';
import { readModelJson } from '../core/review-response';

const CompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().min(1).max(50000) }),
      }),
    )
    .min(1)
    .max(16),
});

export async function runCompatibleAi(input: {
  connection: AiConnection;
  prompt: string;
  model: string;
  signal: AbortSignal;
}): Promise<string> {
  const connection = AiConnectionSchema.parse(input.connection);
  const key = connection.apiKeyEnv ? process.env[connection.apiKeyEnv] : undefined;
  if (connection.apiKeyEnv && !key)
    throw new Error(
      'Set the configured RIGSHELF_AI_ environment variable before starting Rigshelf.',
    );
  if (key && (key.length > 8192 || /[\r\n]/.test(key)))
    throw new Error('The configured AI credential is invalid.');
  let response: Response;
  try {
    response = await fetch(`${connection.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      signal: input.signal,
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: input.model || connection.model,
        messages: [{ role: 'user', content: input.prompt }],
        stream: false,
      }),
    });
  } catch {
    throw new Error(
      'AI connection failed. Check the API base URL, TLS and service availability. Redirects are refused.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `AI connection returned HTTP ${response.status}. Check the model, credential and service limits.`,
    );
  }
  let result: z.infer<typeof CompletionSchema>;
  try {
    result = CompletionSchema.parse(await readModelJson(response));
  } catch {
    throw new Error(
      'AI connection returned an unsupported or oversized response. Expected Chat Completions JSON.',
    );
  }
  const choice = result.choices[0]!;
  if (choice.finish_reason && choice.finish_reason !== 'stop')
    throw new Error('AI connection did not finish the draft. Check the model and response limits.');
  return choice.message.content;
}
