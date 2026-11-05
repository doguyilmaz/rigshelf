import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Preset, Rule, Source } from './model';
import { recordPluginRecipe } from './recipes';
import { hash, slug } from './safety';
import type { Store } from './store';

export const presets: Preset[] = [
  {
    id: 'base',
    name: 'Essentials',
    description: 'A small shared foundation. Add only what the project needs.',
    parentId: null,
    stacks: [],
    selectors: [],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'mobile',
    name: 'Mobile',
    description: 'Shared mobile design and interaction practices.',
    parentId: 'base',
    stacks: ['mobile'],
    selectors: ['mobile-native'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'react-native',
    name: 'React Native',
    description: 'Bare React Native, native modules, gestures and navigation.',
    parentId: 'mobile',
    stacks: ['mobile', 'react-native'],
    selectors: ['react-native-best-practices', 'gestures', 'react-navigation'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'expo',
    name: 'Expo + React Native',
    description: 'Expo Router, native UI and a focused React Native foundation.',
    parentId: 'react-native',
    stacks: ['mobile', 'react-native', 'expo'],
    selectors: ['building-native-ui', 'expo-ui-swiftui', 'expo-ui-jetpack-compose'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'ios',
    name: 'iOS · SwiftUI',
    description: 'Swift, SwiftUI and Apple platform conventions.',
    parentId: 'mobile',
    stacks: ['mobile', 'ios', 'swift'],
    selectors: ['write-swift', 'swiftui', 'apple-design'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'android',
    name: 'Android · Kotlin',
    description: 'Kotlin and Android with Compose.',
    parentId: 'mobile',
    stacks: ['mobile', 'android', 'kotlin'],
    selectors: ['kotlin', 'jetpack-compose'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'macos',
    name: 'macOS',
    description: 'Native desktop apps in Swift and AppKit/SwiftUI.',
    parentId: 'base',
    stacks: ['macos', 'swift'],
    selectors: ['write-swift', 'swiftui'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'web',
    name: 'Web',
    description: 'A clear frontend design and accessible interfaces.',
    parentId: 'base',
    stacks: ['web'],
    selectors: ['frontend-design', 'web-design-guidelines'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'next',
    name: 'Next.js',
    description: 'React, Next.js conventions and frontend design.',
    parentId: 'web',
    stacks: ['web', 'react', 'nextjs'],
    selectors: ['next-best-practices', 'vercel-react-best-practices'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'backend',
    name: 'API / Backend',
    description: 'API contracts, error handling and service boundaries.',
    parentId: 'base',
    stacks: ['backend'],
    selectors: ['api-design'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'bun-hono',
    name: 'Bun + Hono',
    description: 'TypeScript APIs with Bun and Hono.',
    parentId: 'backend',
    stacks: ['backend', 'typescript', 'bun', 'hono'],
    selectors: ['hono', 'bun'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'go',
    name: 'Go',
    description: 'Go services and explicit API boundaries.',
    parentId: 'backend',
    stacks: ['backend', 'go'],
    selectors: ['golang', 'go-best'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
];

presets.push(
  {
    id: 'swift',
    name: 'Swift package',
    description: 'Swift libraries and shared Apple platform code.',
    parentId: 'base',
    stacks: ['swift'],
    selectors: ['write-swift'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'objc',
    name: 'iOS · Objective-C',
    description: 'Existing Objective-C apps and Swift interoperability.',
    parentId: 'mobile',
    stacks: ['ios', 'mobile', 'objective-c'],
    selectors: ['ios', 'objective-c'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'kotlin',
    name: 'Kotlin / JVM',
    description: 'Kotlin libraries, JVM services and explicit API contracts.',
    parentId: 'backend',
    stacks: ['kotlin', 'backend'],
    selectors: ['kotlin', 'api-design'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'astro',
    name: 'Astro',
    description: 'Content sites and focused interactive islands.',
    parentId: 'web',
    stacks: ['astro', 'web'],
    selectors: ['astro'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
  {
    id: 'cli',
    name: 'CLI / Developer tools',
    description: 'Command-line tools, useful errors and scripting contracts.',
    parentId: 'base',
    stacks: ['cli'],
    selectors: ['api-design'],
    entryIds: [],
    excludedIds: [],
    providers: ['claude', 'codex'],
  },
);

const rules: Rule[] = [
  {
    id: 'communication',
    name: 'Clear communication',
    scope: 'global',
    content:
      'Keep replies short, clear, and concrete. Lead with the result. Explain material limitations. Commit only when authorized, with meaningful messages describing the change.',
    enabled: true,
    priority: 10,
    provenance: 'User requirements',
  },
  {
    id: 'engineering',
    name: 'Engineering habits',
    scope: 'global',
    content:
      'Handle async failures explicitly. Use descriptive names and named constants when numbers carry meaning. Keep functions focused; split functions longer than roughly 50 lines when it improves clarity. Avoid deeply nested callbacks. Remove temporary debug logging before completing work.',
    enabled: true,
    priority: 20,
    provenance: 'User requirements',
  },
  {
    id: 'typescript',
    name: 'TypeScript contracts',
    scope: 'typescript',
    content:
      'Avoid explicit any. Validate untrusted input at boundaries. Prefer small, typed interfaces and clear error states.',
    enabled: true,
    priority: 30,
    provenance: 'User requirements',
  },
  {
    id: 'mobile',
    name: 'Mobile verification',
    scope: 'mobile',
    content:
      'Validate visible UI changes on the selected simulator or emulator using the available device tools. Check safe areas, keyboard behavior, loading states, and accessible controls.',
    enabled: true,
    priority: 40,
    provenance: 'User requirements',
  },
  {
    id: 'backend',
    name: 'Backend boundaries',
    scope: 'backend',
    content:
      'Validate requests and return explicit errors. Keep credentials outside source. Test meaningful authorization and data boundaries. Avoid speculative infrastructure.',
    enabled: true,
    priority: 40,
    provenance: 'User requirements',
  },
];

export function classifyResource(line: string): Source {
  const url = line.match(/https?:\/\/[^\s]+/)?.[0] || '';
  const ownerRepo = url
    .match(/^https:\/\/github\.com\/([^/]+\/[^/#?]+)/)?.[1]
    ?.replace(/\.git$/, '');
  const skillsRepo = url.match(/^https:\/\/skills\.sh\/([^/]+\/[^/#?]+)/)?.[1];
  const recipeRepo = line.match(/(?:skills|add-skill)\s+(?:add\s+)?([\w.-]+\/[\w.-]+)/)?.[1];
  const marketplaceRepo = line.match(/\/plugin marketplace add ([\w.-]+\/[\w.-]+)/)?.[1];
  const repo = ownerRepo || skillsRepo || recipeRepo || marketplaceRepo;
  const explicit = /^(?:bun|bunx|npx|npm|pnpm|yarn|curl|\/plugin)\b/.test(line);
  const type: Source['type'] =
    repo && !url.includes('/status/')
      ? 'github'
      : line.startsWith('/plugin')
        ? 'plugin'
        : url.includes('skills.sh')
          ? 'listing'
          : 'resource';
  const name =
    repo || (url ? new URL(url).hostname + new URL(url).pathname.replace(/\/$/, '') : line);
  const canonicalUrl = repo && type === 'github' ? `https://github.com/${repo}` : url;
  return {
    id:
      repo && type === 'github'
        ? `github-${hash(canonicalUrl.toLowerCase()).slice(0, 20)}`
        : `source-${hash(line).slice(0, 16)}`,
    name: name.slice(0, 500),
    url: canonicalUrl,
    type,
    recipe: explicit
      ? line.replace(/^bunx add-skill /, 'bunx skills add ')
      : type === 'github' && repo && (line.includes('skills.sh') || /skill/i.test(repo))
        ? `bunx skills add ${repo}`
        : '',
    status: 'unchecked',
    recipeKind: explicit ? 'explicit' : 'suggested',
    categories: line.startsWith('/plugin') ? ['plugin'] : undefined,
    notes: line + (line.includes('curl') ? '\nManual recipe; never automatically executed.' : ''),
  };
}

export function seed(store: Store): void {
  if (store.get('meta', 'seed-v1')) return;
  const lines = readFileSync(
    fileURLToPath(new URL('../../data/resource-notes.txt', import.meta.url)),
    'utf8',
  )
    .split('\n')
    .filter(Boolean);
  for (const line of [...new Set(lines)]) {
    const source = classifyResource(line);
    const previous = store.get<Source>('source', source.id);
    store.put(
      'source',
      previous
        ? {
            ...previous,
            notes: previous.notes.includes(line) ? previous.notes : `${previous.notes}\n${line}`,
            categories: [
              ...new Set([...(previous.categories || []), ...(source.categories || [])]),
            ],
          }
        : source,
    );
    recordPluginRecipe(store, source, line.startsWith('/plugin ') ? line : '');
  }
  for (const preset of presets) store.put('preset', preset);
  for (const rule of rules) store.put('rule', rule);
  store.put('meta', { id: 'seed-v1', name: slug('version one') });
}
