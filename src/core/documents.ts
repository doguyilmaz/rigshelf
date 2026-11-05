import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { z } from 'zod';
import { readText } from './detect';
import type { Plan, Project } from './model';
import { rootIdentity } from './ownership';
import { planView } from './plan-view';
import { assertWritePath, checkedProject, hash, now, redact, scanText } from './safety';
import type { Store } from './store';

const DocumentSchema = z.object({ projectId: z.string(), path: z.string().max(4096) });
async function document(store: Store, raw: unknown) {
  const input = DocumentSchema.parse(raw);
  const project = store.get<Project>('project', input.projectId);
  if (!project?.documents.includes(input.path))
    throw new Error('Document is not part of this project inventory');
  await checkedProject(project.path);
  const target = await assertWritePath(project.path, input.path);
  const content = await readText(target);
  if (content === undefined) throw new Error('Document no longer exists. Scan the project again.');
  return { project, path: input.path, target, content };
}
export async function projectDocument(store: Store, raw: unknown) {
  const value = await document(store, raw);
  const content = redact(value.content);
  return {
    path: value.path,
    content,
    digest: hash(value.content),
    redacted: content !== value.content,
    note: 'Loaded on request. No session history is collected.',
  };
}
export async function documentPlan(store: Store, raw: unknown) {
  const input = DocumentSchema.extend({
    content: z.string().max(512 * 1024),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }).parse(raw);
  const value = await document(store, input);
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
