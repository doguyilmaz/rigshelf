import { z } from 'zod';
import { canonicalBackup } from './backup-review';
import { hash } from './safety';
import type { Store } from './store';

const CredentialReference = z
  .string()
  .max(100)
  .regex(/^RIGSHELF_BACKUP_[A-Z0-9_]+$/);
const Prefix = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine(
    (value) => value.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Use a relative prefix without empty or traversal segments.',
  );
const common = {
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(1).max(80),
  prefix: Prefix.default('rigshelf'),
};
const Branch = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      !/^[./-]|[./]$|\.\.|@\{|[\s~^:?*[\\]/.test(value) &&
      !Array.from(value).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) &&
      !value.endsWith('.lock') &&
      !value.includes('//'),
    'Choose a valid Git branch name.',
  );
export const GithubBackupSchema = z
  .object({
    ...common,
    kind: z.literal('github'),
    owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/),
    repository: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,100}$/)
      .refine((value) => value !== '.' && value !== '..'),
    branch: Branch.default('main'),
    tokenEnv: CredentialReference.default('RIGSHELF_BACKUP_GITHUB_TOKEN'),
  })
  .strict();
export const S3BackupSchema = z
  .object({
    ...common,
    kind: z.literal('s3'),
    service: z.enum(['s3', 'r2', 'minio', 'custom']).default('s3'),
    endpoint: z
      .string()
      .trim()
      .max(2048)
      .superRefine((value, context) => {
        try {
          const url = new URL(value);
          const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
          if (
            (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            url.pathname !== '/' ||
            /[?#]/.test(value) ||
            ['0.0.0.0', '169.254.169.254', '[::]'].includes(url.hostname)
          )
            throw new Error();
        } catch {
          context.addIssue({
            code: 'custom',
            message:
              'Use an HTTPS S3 endpoint origin, or HTTP on loopback, without credentials, path, query or fragment.',
          });
        }
      }),
    bucket: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/)
      .refine((value) => !value.includes('..')),
    region: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9-]+$/)
      .default('auto'),
    accessKeyEnv: CredentialReference.default('RIGSHELF_BACKUP_S3_ACCESS_KEY_ID'),
    secretKeyEnv: CredentialReference.default('RIGSHELF_BACKUP_S3_SECRET_ACCESS_KEY'),
    sessionTokenEnv: z.union([CredentialReference, z.literal('')]).default(''),
    privateBucketConfirmed: z.literal(true),
  })
  .strict();
export const BackupDestinationSchema = z.discriminatedUnion('kind', [
  GithubBackupSchema,
  S3BackupSchema,
]);
export type BackupDestination = z.infer<typeof BackupDestinationSchema>;
export type GithubBackupDestination = z.infer<typeof GithubBackupSchema>;
export type S3BackupDestination = z.infer<typeof S3BackupSchema>;

export function backupDestination(store: Store, id: string): BackupDestination {
  const value = store.get('backup-destination', id);
  if (!value) throw new Error('Backup destination not found.');
  return BackupDestinationSchema.parse(value);
}
export function destinationFingerprint(value: BackupDestination): string {
  const { name, ...configuration } = value;
  return hash(canonicalBackup(configuration));
}
export function destinationIdentity(value: BackupDestination): string {
  return hash(
    canonicalBackup(
      value.kind === 'github'
        ? {
            kind: value.kind,
            owner: value.owner.toLowerCase(),
            repository: value.repository.toLowerCase(),
            branch: value.branch,
            prefix: value.prefix,
          }
        : {
            kind: value.kind,
            endpoint: new URL(value.endpoint).origin,
            bucket: value.bucket,
            prefix: value.prefix,
          },
    ),
  );
}
export function destinationLabel(value: BackupDestination): string {
  return value.kind === 'github'
    ? `github.com/${value.owner}/${value.repository} · ${value.branch} · ${value.prefix}/`
    : `${new URL(value.endpoint).origin}/${value.bucket}/${value.prefix}/`;
}
export function credentialReferences(value: BackupDestination): string[] {
  return value.kind === 'github'
    ? [value.tokenEnv]
    : [
        value.accessKeyEnv,
        value.secretKeyEnv,
        ...(value.sessionTokenEnv ? [value.sessionTokenEnv] : []),
      ];
}
export function backupCredential(
  reference: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  CredentialReference.parse(reference);
  const value = environment[reference];
  if (!value?.trim())
    throw new Error(`Set ${reference} in the Rigshelf server environment and restart it.`);
  if (value.length > 8192 || /[\r\n\0]/.test(value))
    throw new Error(`Invalid credential value in ${reference}.`);
  return value;
}
