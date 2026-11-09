import type { Installation } from './model';
import type { PluginEvidence } from './plugin-model';

export type PluginStatus = PluginEvidence | 'reference';
export const pluginEvidenceLabels: Record<PluginStatus, string> = {
  installed: 'Installation record',
  configured: 'In configuration',
  local: 'Local package or module',
  cached: 'In cache',
  catalog: 'Marketplace catalog',
  reference: 'Saved reference',
};
const priority: PluginEvidence[] = ['installed', 'configured', 'local', 'cached', 'catalog'];
export function pluginStatus(locations: Installation[]): PluginStatus {
  return (
    priority.find((evidence) =>
      locations.some((location) => location.plugin?.evidence === evidence),
    ) || 'reference'
  );
}
/** Cache/catalog observations are not project use or global installation evidence. */
export function usageLocations(locations: Installation[]): Installation[] {
  return locations.filter(
    (location) => !location.plugin || !['cached', 'catalog'].includes(location.plugin.evidence),
  );
}
