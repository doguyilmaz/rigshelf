import { basename, isAbsolute, resolve } from 'node:path';
import type { Entry, Installation, Project, Source } from './model';
import { type PluginLocation, type PluginReference, PluginReferenceSchema } from './plugin-model';
import { hash, now, scanText } from './safety';
import type { Store } from './store';

export function savePluginReference(store: Store, input: PluginReference, description = ''): Entry {
  const plugin = PluginReferenceSchema.parse(input);
  const body = JSON.stringify(plugin, null, 2);
  const id = `native-plugin-${hash(body).slice(0, 24)}`;
  const previous = store.entry(id);
  if (previous) return previous;
  const marketplace =
    plugin.nativeId.includes('@') && !plugin.nativeId.startsWith('@')
      ? plugin.nativeId.slice(plugin.nativeId.lastIndexOf('@') + 1)
      : plugin.manifest === 'npm'
        ? 'npm'
        : 'local';
  const source: Source = {
    id: `native-plugins-${hash(`${plugin.provider}:${marketplace}`).slice(0, 24)}`,
    name: `${plugin.provider} · ${marketplace}`,
    url: '',
    type: 'plugin',
    recipe: '',
    status: 'unchecked',
    notes:
      'Native Plugin references discovered from local metadata. Cache and catalog presence do not establish installation, activation or publisher verification.',
  };
  if (!store.get('source', source.id)) store.put('source', source);
  const entry: Entry = {
    id,
    name: plugin.nativeId,
    kind: 'plugin',
    sourceId: source.id,
    description:
      description ||
      'Native Plugin reference. Review its observed evidence and native harness requirements.',
    tags: [plugin.provider, 'plugin', ...plugin.components],
    digest: hash(body),
    custom: plugin.manifest === 'module',
    body,
    plugin,
    findings: [
      ...scanText(body),
      {
        code: 'native-plugin-reference',
        level: 'info',
        message:
          'Reference metadata only; the native package, hooks and scripts were not executed or copied. This is not proof that the Plugin is active or safe.',
      },
    ],
    updatedAt: now(),
  };
  store.saveEntry(entry);
  return entry;
}

export function pluginProject(
  store: Store,
  path: string | undefined,
  provider: string,
): Project | undefined {
  if (!path || !isAbsolute(path) || path.length > 4096 || /[\0\r\n]/.test(path)) return;
  const absolute = resolve(path);
  const existing = store.projects().find((project) => resolve(project.path) === absolute);
  if (existing) return existing;
  const project: Project = {
    id: `project-${hash(absolute).slice(0, 20)}`,
    name: basename(absolute),
    path: absolute,
    stacks: [],
    dependencies: [],
    providers: [provider],
    documents: [],
    detectedAt: now(),
    requirements: '',
    discovery: 'configuration',
  };
  store.put('project', project);
  return project;
}

export function recordPluginLocation(
  store: Store,
  entry: Entry,
  file: string,
  reference: PluginLocation,
  observed: Set<string>,
  project?: Project,
): void {
  const identity = hash(
    `${entry.plugin?.provider}:${reference.nativeId}:${reference.evidence}:${reference.version || ''}:${reference.declaredScope || ''}:${project?.path || ''}`,
  ).slice(0, 32);
  const path = `${file}#plugin:${identity}`;
  const location: Installation = {
    entryId: entry.id,
    projectId: project?.id || null,
    provider: entry.plugin!.provider,
    path,
    scope: project ? 'project' : 'global',
    storage: ['cached', 'catalog'].includes(reference.evidence)
      ? 'plugin-cache'
      : project
        ? 'project-config'
        : 'user-config',
    lastSeen: now(),
    plugin: reference,
  };
  store.installation(location);
  observed.add(path);
  if (project) {
    const current = store.get<Project>('project', project.id) || project;
    if (!current.providers.includes(entry.plugin!.provider)) {
      current.providers.push(entry.plugin!.provider);
      store.put('project', current);
    }
  }
}
