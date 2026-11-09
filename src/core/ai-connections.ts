import { z } from 'zod';

export const AiModelSchema = z
  .string()
  .trim()
  .max(100)
  .regex(/^(?:[A-Za-z0-9][A-Za-z0-9._:/#-]*)?$/);
export const AiConnectionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    name: z.string().trim().min(1).max(80),
    baseUrl: z
      .string()
      .trim()
      .max(2048)
      .superRefine((value, context) => {
        try {
          const url = new URL(value);
          const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
          if (
            (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            /[?#]/.test(value) ||
            ['0.0.0.0', '169.254.169.254', '[::]'].includes(url.hostname)
          )
            throw new Error();
        } catch {
          context.addIssue({
            code: 'custom',
            message:
              'Use an HTTPS API base URL, or HTTP on loopback, without credentials, query or fragment.',
          });
        }
      }),
    model: AiModelSchema.refine((value) => value.length > 0, 'Choose a model.'),
    apiKeyEnv: z
      .string()
      .trim()
      .max(100)
      .regex(/^(?:RIGSHELF_AI_[A-Z0-9_]+)?$/)
      .default(''),
  })
  .strict();
export type AiConnection = z.infer<typeof AiConnectionSchema>;
export const AiConnectionsSchema = z
  .array(AiConnectionSchema)
  .max(12)
  .default([])
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    'AI connection IDs must be unique.',
  );
