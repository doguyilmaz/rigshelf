const key = 'rigshelf:recent-projects:v1';
const MAX_RECENT_PROJECTS = 12;
export function recentProjectIds(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw)
      ? raw
          .filter(
            (value): value is string =>
              typeof value === 'string' && /^project-[a-f0-9]{20}$/.test(value),
          )
          .slice(0, MAX_RECENT_PROJECTS)
      : [];
  } catch {
    return [];
  }
}
export function rememberProject(id: string): void {
  if (!/^project-[a-f0-9]{20}$/.test(id)) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify(
        [id, ...recentProjectIds().filter((value) => value !== id)].slice(0, MAX_RECENT_PROJECTS),
      ),
    );
  } catch {
    /* The recent list is optional and grants no project authority. */
  }
}
