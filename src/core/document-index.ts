import type { DocumentLocation, Project } from './model';

export type DocumentChoice = Pick<
  DocumentLocation,
  'id' | 'path' | 'scope' | 'provider' | 'sourcePath' | 'readOnly'
>;
/** Keep legacy project-relative records visible while a partial/global-only rescan adds richer locations. */
export function documentChoices(project: Project): DocumentChoice[] {
  const indexed = project.documentLocations || [];
  const legacy: DocumentChoice[] = project.documents
    .filter((path) => !indexed.some((file) => file.scope === 'project' && file.path === path))
    .map((path) => ({
      id: '',
      path,
      scope: 'project',
      provider: 'project',
      sourcePath: `${project.path}/${path}`,
      readOnly: false,
    }));
  return [...legacy, ...indexed].map(({ id, path, scope, provider, sourcePath, readOnly }) => ({
    id,
    path,
    scope,
    provider,
    sourcePath,
    readOnly,
  }));
}
