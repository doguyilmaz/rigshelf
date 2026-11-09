import { basename, isAbsolute, resolve } from 'node:path';
import type { Installation, Project } from './model';
import { object } from './providers';
import { hash, now } from './safety';
import type { Store } from './store';

interface Group {
  project?: Project;
  servers: Record<string, unknown>;
  fragment: string;
  storage: Installation['storage'];
}
export function mcpLocationGroups(
  store: Store,
  config: Record<string, unknown>,
  key: string,
  localPath: string,
  project?: Project,
): Group[] {
  const groups: Group[] = [
    {
      project,
      servers: object(config[key]),
      fragment: '',
      storage: project ? 'project-config' : 'user-config',
    },
  ];
  if (project || localPath !== '.claude.json') return groups;
  for (const [path, raw] of Object.entries(object(config.projects))) {
    const servers = object(object(raw).mcpServers);
    if (!Object.keys(servers).length || !isAbsolute(path)) continue;
    const absolute = resolve(path);
    const id = `project-${hash(absolute).slice(0, 20)}`;
    const referenced = store.get<Project>('project', id) || {
      id,
      name: basename(absolute),
      path: absolute,
      stacks: [],
      dependencies: [],
      providers: [],
      documents: [],
      detectedAt: now(),
      requirements: '',
      discovery: 'configuration' as const,
    };
    if (!referenced.providers.includes('claude')) referenced.providers.push('claude');
    store.put('project', referenced);
    groups.push({
      project: referenced,
      servers,
      fragment: `project:${encodeURIComponent(absolute)}/`,
      storage: 'user-project-config',
    });
  }
  return groups;
}
