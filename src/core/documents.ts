import { randomUUID } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AiFileInventory } from './ai-files';
import { readLocalBytes } from './local-files';
import { MAX_TEXT_BYTES, type Plan, type Project } from './model';
import { rootIdentity } from './ownership';
import { planView } from './plan-view';
import { assertWritePath, checkedProject, hash, inside, now, redact, scanText } from './safety';
import type { Store } from './store';

const DocumentSchema = z.object({
  projectId: z.string(),
  path: z.string().max(4096).optional(),
  documentId: z.string().max(100).optional(),
});
async function document(store: Store, raw: unknown) {
  const input = DocumentSchema.parse(raw);
  const project = store.get<Project>('project', input.projectId);
  if (!project || Boolean(input.path) === Boolean(input.documentId))
    throw new Error('Document is not part of this project inventory');
  const location = input.documentId
    ? [
        ...(project.documentLocations || []),
        ...(project.aiFileLocations || []),
        ...(store.get<AiFileInventory>('global-ai-inventory', 'main')?.files || []),
      ].find((file) => file.id === input.documentId)
    : undefined;
  if (input.documentId && !location)
    throw new Error('Document is not part of this project inventory');
  if (!location && !project.documents.includes(input.path!))
    throw new Error('Document is not part of this project inventory');
  if (
    !location ||
    location.scope === 'project' ||
    inside(resolve(project.path), location.sourcePath)
  )
    await checkedProject(project.path);
  let target: string;
  if (location) {
    const root = await realpath(location.root);
    const info = await stat(root);
    if (
      root !== location.root ||
      `${info.dev}:${info.ino}` !== location.rootIdentity ||
      (await realpath(location.sourcePath)) !== location.canonicalPath
    )
      throw new Error('Document location changed. Scan the project again.');
    target = await assertWritePath(root, location.relativePath);
    if (target !== location.canonicalPath)
      throw new Error('Document location changed. Scan the project again.');
  } else target = await assertWritePath(project.path, input.path!);
  const content = (await readLocalBytes(target, MAX_TEXT_BYTES)).toString('utf8');
  const readOnly = location
    ? location.readOnly || location.scope !== 'project' || !inside(resolve(project.path), target)
    : false;
  return { project, path: location?.path || input.path!, target, content, readOnly, location };
}
export async function projectDocument(store: Store, raw: unknown) {
  const value = await document(store, raw);
  const content = redact(value.content);
  return {
    path: value.path,
    content,
    digest: hash(value.content),
    redacted: content !== value.content,
    readOnly: value.readOnly,
    sourcePath: value.location?.sourcePath || value.target,
    scope: value.location?.scope || 'project',
    provider: value.location?.provider || 'project',
    kind: value.location?.kind || (/MEMORY/i.test(value.path) ? 'memory' : 'instruction'),
    note: 'Loaded on request. No session history is collected.',
  };
}
export async function documentPlan(store: Store, raw: unknown) {
  const input = DocumentSchema.extend({
    content: z
      .string()
      .max(MAX_TEXT_BYTES)
      .refine(
        (content) => Buffer.byteLength(content, 'utf8') <= MAX_TEXT_BYTES,
        'Document exceeds the UTF-8 byte limit.',
      ),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }).parse(raw);
  const value = await document(store, input);
  if (value.readOnly)
    throw new Error(
      'External or shared guidance is read-only here. Create a reviewed project directive instead.',
    );
  if (hash(value.content) !== input.digest)
    throw new Error('Document changed since opening. Reload it before editing.');
  if (redact(value.content) !== value.content)
    throw new Error(
      'A masked document cannot be safely edited here. Edit its private original directly.',
    );
  if (scanText(input.content).some((finding) => finding.level === 'block'))
    throw new Error('Possible credential in proposed document. Keep credentials outside guidance.');
  const plan: Plan = {
    id: randomUUID(),
    projectPath: value.project.path,
    providers: [],
    entries: [],
    createdAt: now(),
    changes:
      input.content === value.content
        ? []
        : [
            {
              path: value.path,
              beforeHash: input.digest,
              before: Buffer.from(value.content).toString('base64'),
              after: Buffer.from(input.content).toString('base64'),
              reason: 'Update the explicitly selected instruction or memory file',
              beforeMode: (await lstat(value.target)).mode & 0o777,
              afterMode: (await lstat(value.target)).mode & 0o777,
            },
          ],
    warnings: [
      'Review project-private details before promoting this content to a broader directive scope.',
    ],
    status: 'planned',
    purpose: 'document',
    rootIdentity: await rootIdentity(value.project.path),
  };
  store.put('plan', plan);
  store.event('document.planned', `${value.project.name}: ${value.path}`);
  return planView(plan);
}
