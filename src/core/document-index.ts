import type { DocumentLocation, Project } from './model';

export type DocumentChoice = Pick<
  DocumentLocation,
  'id' | 'path' | 'scope' | 'provider' | 'sourcePath' | 'readOnly' | 'kind'
>;
export function documentChoices(
  project: Project,
  shared: DocumentLocation[] = [],
): DocumentChoice[] {
  const indexed = [
    ...(project.documentLocations || []),
    ...(project.aiFileLocations || []),
    ...shared,
  ];
  const legacy: DocumentChoice[] = project.documents
    .filter((path) => !indexed.some((file) => file.scope === 'project' && file.path === path))
    .map((path) => ({
      id: '',
      path,
      scope: 'project',
      provider: 'project',
      sourcePath: `${project.path}/${path}`,
      readOnly: false,
      kind: /MEMORY/i.test(path) ? 'memory' : 'instruction',
    }));
  const unique = [
    ...new Map([...legacy, ...indexed].map((file) => [file.id || file.path, file])).values(),
  ];
  return unique.map(({ id, path, scope, provider, sourcePath, readOnly, kind }) => ({
    id,
    path,
    scope,
    provider,
    sourcePath,
    readOnly,
    kind,
  }));
}
