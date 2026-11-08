import type { Entry, Preset, Project, Rule } from './model';
import { slug } from './names';
import type { Store } from './store';

export function presetChain(store: Store, id: string, visited = new Set<string>()): Preset[] {
  if (visited.has(id)) throw new Error('Preset inheritance contains a cycle.');
  visited.add(id);
  const preset = store.get<Preset>('preset', id);
  if (!preset) throw new Error(`Preset does not exist: ${id}`);
  return [...(preset.parentId ? presetChain(store, preset.parentId, visited) : []), preset];
}
export function matchingPreset(project: Project): string {
  const choices: [string, string][] = [
    ['expo', 'expo'],
    ['react-native', 'react-native'],
    ['cli', 'cli'],
    ['macos', 'macos'],
    ['objective-c', 'objc'],
    ['ios', 'ios'],
    ['android', 'android'],
    ['swift', 'swift'],
    ['kotlin', 'kotlin'],
    ['nextjs', 'next'],
    ['hono', 'bun-hono'],
    ['go', 'go'],
    ['astro', 'astro'],
    ['web', 'web'],
    ['backend', 'backend'],
  ];
  return choices.find(([stack]) => project.stacks.includes(stack))?.[1] || 'base';
}
export interface Recommendation {
  entry: Omit<Entry, 'body'>;
  score: number;
  reasons: string[];
  selected: boolean;
}
const genericTerms = new Set([
  'and',
  'with',
  'for',
  'the',
  'from',
  'using',
  'use',
  'into',
  'that',
  'have',
  'has',
  'this',
  'should',
  'will',
  'want',
  'build',
  'create',
  'make',
  'please',
  'also',
  'only',
  'new',
  'can',
  'are',
  'our',
  'your',
  'bir',
  'ile',
  'icin',
  'olan',
  'olsun',
  'olacak',
  'proje',
  'uygulama',
  'this',
  'that',
  'with',
  'from',
  'using',
  'build',
  'want',
  'need',
  'project',
  'application',
  'app',
  'web',
  'mobile',
  'backend',
  'frontend',
  'react',
  'native',
  'expo',
  'typescript',
  'javascript',
  'support',
  'simple',
  'server',
  'api',
]);
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const containsParts = (name: string, term: string) => `-${name}-`.includes(`-${term}-`);
const genericSegments = new Set([
  'test',
  'cli',
  'core',
  'compat',
  'components',
  'utils',
  'types',
  'config',
  'schema',
  'node',
  'react',
  'vue',
  'native',
  'client',
  'server',
  'runtime',
  'plugin',
  'kit',
]);
function dependencyTerm(name: string): string | undefined {
  if (name.startsWith('@types/')) return;
  const last = name.split('/').at(-1)!;
  const scope = name.startsWith('@') ? name.slice(1).split('/')[0] : undefined;
  return normalize(scope && genericSegments.has(normalize(last)) ? scope : last);
}
interface ScoreContext {
  selectors: string[];
  explicit: Map<string, number>;
  existing: Set<string>;
  dependencies: string[];
  terms: string[];
  presetId: string;
  stacks: Set<string>;
}
type RankedRecommendation = Recommendation & { targets: string[] };
function scoreEntry(entry: Omit<Entry, 'body'>, context: ScoreContext): RankedRecommendation {
  const reasons: string[] = [];
  const targets: string[] = [];
  let score = 0;
  const name = normalize(entry.name);
  for (const selector of context.selectors)
    if (name.includes(normalize(selector))) {
      score += name === normalize(selector) ? 90 : 55;
      reasons.push(`Included by ${context.presetId}: ${selector}`);
      targets.push(`selector:${normalize(selector)}`);
    }
  if (context.explicit.has(entry.id)) {
    score += 200 + context.explicit.get(entry.id)!;
    reasons.push('Explicit preset selection');
  }
  for (const dependency of context.dependencies)
    if (
      name === dependency ||
      (containsParts(name, dependency) &&
        (dependency.includes('-') || context.stacks.has(dependency)))
    ) {
      score += name === dependency ? 120 : 70;
      reasons.push(`Detected dependency: ${dependency}`);
      targets.push(`technology:${dependency}`);
    }
  for (const term of context.terms)
    if (containsParts(name, term) || entry.tags.includes(term)) {
      score += name === term ? 100 : 60;
      reasons.push(`Matches requirement: ${term}`);
      targets.push(`technology:${term}`);
    }
  if (context.existing.has(entry.id)) {
    score += 300;
    reasons.unshift('Preserved from this project’s existing kit');
  }
  if (entry.findings.some((finding) => finding.level === 'block'))
    return {
      entry,
      reasons,
      targets,
      score: context.existing.has(entry.id) ? 1 : 0,
      selected: false,
    };
  const selected = context.existing.has(entry.id);
  if (!selected && needsReview(entry)) reasons.push('Needs review before selection');
  return { entry, reasons, targets, score, selected };
}
const needsReview = (entry: Omit<Entry, 'body'>) =>
  entry.findings.some((finding) => finding.level === 'review');
export function recommend(
  store: Store,
  project: Project,
  presetId = matchingPreset(project),
): { presetId: string; recommendations: Recommendation[]; missing: string[]; warnings: string[] } {
  const chain = presetChain(store, presetId);
  const explicit = new Map<string, number>(),
    excluded = new Set<string>();
  chain.forEach((preset, depth) => {
    for (const id of preset.entryIds) {
      explicit.set(id, depth);
      excluded.delete(id);
    }
    for (const id of preset.excludedIds) {
      explicit.delete(id);
      excluded.add(id);
    }
  });
  const existing = new Set(
    store
      .installations()
      .filter((location) => location.projectId === project.id)
      .map((location) => location.entryId),
  );
  const selectors = [...new Set(chain.flatMap((preset) => preset.selectors))];
  const dependencies = [
    ...new Set([
      ...project.dependencies.map(dependencyTerm).filter((name): name is string => Boolean(name)),
      ...project.stacks.filter((tag) =>
        [
          'better-auth',
          'clerk',
          'firebase',
          'sentry',
          'react-query',
          'cloudflare',
          'unity',
        ].includes(tag),
      ),
    ]),
  ].filter((name) => name.length >= 3 && !genericTerms.has(name));
  const terms = [
    ...new Set(project.requirements.toLowerCase().match(/[a-z][a-z0-9]*(?:[-/][a-z0-9]+)*/g) || []),
  ]
    .map(normalize)
    .filter((term) => term.length >= 3 && !genericTerms.has(term));
  const context = {
    selectors,
    explicit,
    existing,
    dependencies,
    terms,
    presetId,
    stacks: new Set(project.stacks),
  };
  const catalog = store
    .entries(true)
    .filter((entry) => !entry.archived || existing.has(entry.id) || explicit.has(entry.id));
  const ranked = catalog
    .filter((entry) => ['skill', 'mcp'].includes(entry.kind) && !excluded.has(entry.id))
    .map((entry) => scoreEntry(entry, context))
    .filter((value) => value.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || right.entry.updatedAt.localeCompare(left.entry.updatedAt),
    );
  const seen = new Set<string>();
  const warnings: string[] = [];
  const recommendations: Recommendation[] = [];
  let automaticPicks = 0;
  const coveredTargets = new Set<string>();
  for (const value of ranked) {
    const key = `${value.entry.kind}:${slug(value.entry.name)}`;
    if (seen.has(key)) {
      if (existing.has(value.entry.id))
        warnings.push(
          `Multiple existing revisions of ${value.entry.name}; select one explicitly before changing those files.`,
        );
      continue;
    }
    seen.add(key);
    if (
      !existing.has(value.entry.id) &&
      !explicit.has(value.entry.id) &&
      recommendations.filter((item) => !existing.has(item.entry.id)).length >= 20
    )
      continue;
    if (
      !value.selected &&
      (explicit.has(value.entry.id) ||
        (value.score >= 55 &&
          automaticPicks < 10 &&
          value.targets.some((target) => !coveredTargets.has(target)))) &&
      !value.entry.findings.some((finding) => finding.level === 'block') &&
      !needsReview(value.entry)
    ) {
      value.selected = true;
      if (!explicit.has(value.entry.id)) automaticPicks++;
    } else if (value.selected && !explicit.has(value.entry.id)) automaticPicks++;
    if (value.selected) for (const target of value.targets) coveredTargets.add(target);
    const { targets: _targets, ...recommendation } = value;
    recommendations.push(recommendation);
  }
  const missing = [
    ...selectors.filter(
      (selector) => !catalog.some((entry) => normalize(entry.name).includes(normalize(selector))),
    ),
    ...[...explicit.keys()]
      .filter((id) => !store.entry(id))
      .map((id) => `Missing pinned capability: ${id}`),
  ];
  return { presetId, recommendations, missing, warnings };
}

export function effectiveRules(store: Store, project: Project, extraStacks: string[] = []): Rule[] {
  const rank = (scope: string): number =>
    scope === 'global'
      ? 0
      : ['mobile', 'web', 'backend'].includes(scope)
        ? 1
        : scope === project.id
          ? 4
          : ['expo', 'react-native', 'nextjs', 'hono'].includes(scope)
            ? 3
            : 2;
  return store
    .list<Rule>('rule')
    .filter(
      (rule) =>
        rule.enabled &&
        (rule.scope === 'global' ||
          [...project.stacks, ...extraStacks].includes(rule.scope) ||
          rule.scope === project.id),
    )
    .sort(
      (left, right) =>
        rank(left.scope) - rank(right.scope) ||
        left.priority - right.priority ||
        left.id.localeCompare(right.id),
    );
}
