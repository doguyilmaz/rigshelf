import type { Entry } from './model';

export interface Category {
  id: string;
  label: string;
  aliases: string[];
}
const category = (id: string, label: string, ...aliases: string[]): Category => ({
  id,
  label,
  aliases: [id, label, ...aliases],
});
export const platforms = [
  category('mobile', 'Mobile'),
  category('ios', 'iOS', 'iphone', 'ipad', 'testflight', 'app-store'),
  category('android', 'Android', 'jetpack'),
  category('web', 'Web', 'frontend', 'browser', 'html', 'css'),
  category('backend', 'Backend / API', 'backend', 'api', 'server'),
  category('desktop', 'Desktop', 'electron', 'tauri'),
  category('macos', 'macOS', 'appkit'),
  category('general', 'General', 'cross-platform', 'platform-agnostic'),
];
export const technologies = [
  category('expo', 'Expo'),
  category('react-native', 'React Native', 'reactnative'),
  category('swiftui', 'SwiftUI'),
  category('swift', 'Swift'),
  category('kotlin', 'Kotlin'),
  category('compose', 'Jetpack Compose', 'jetpack-compose'),
  category('react', 'React'),
  category('nextjs', 'Next.js', 'next-js', 'nextjs', 'next'),
  category('vue', 'Vue', 'nuxt'),
  category('svelte', 'Svelte', 'sveltekit'),
  category('astro', 'Astro'),
  category('typescript', 'TypeScript', 'ts'),
  category('javascript', 'JavaScript', 'js'),
  category('go', 'Go', 'golang'),
  category('bun', 'Bun'),
  category('nodejs', 'Node.js', 'node'),
  category('hono', 'Hono'),
  category('express', 'Express'),
  category('fastify', 'Fastify'),
  category('cloudflare', 'Cloudflare', 'wrangler', 'durable-objects', 'cloudflare-workers'),
  category('better-auth', 'Better Auth'),
  category('clerk', 'Clerk'),
  category('firebase', 'Firebase', 'firestore'),
  category('supabase', 'Supabase'),
  category('postgres', 'PostgreSQL', 'postgresql'),
  category('sqlite', 'SQLite'),
  category('react-query', 'TanStack Query', 'react-query', 'tanstack-query'),
  category('tailwind', 'Tailwind CSS', 'tailwind'),
  category('nativewind', 'NativeWind'),
  category('uniwind', 'Uniwind'),
  category('reanimated', 'Reanimated'),
  category('nitro', 'Nitro Modules', 'nitro-modules', 'nitro-fetch'),
  category('react-navigation', 'React Navigation'),
  category('react-email', 'React Email'),
  category('resend', 'Resend'),
  category('stripe', 'Stripe'),
  category('sentry', 'Sentry'),
  category('playwright', 'Playwright'),
  category('vitest', 'Vitest'),
  category('jest', 'Jest'),
  category('docker', 'Docker'),
  category('python', 'Python'),
  category('rust', 'Rust'),
];
export const topics = [
  category('auth', 'Authentication', 'auth', 'oauth', 'better-auth', 'clerk', 'sign-in', 'login'),
  category(
    'design',
    'UI & design',
    'design',
    'ui',
    'ux',
    'animation',
    'animations',
    'microinteractions',
    'tailwind',
    'onboarding',
  ),
  category('testing', 'Testing', 'test', 'tests', 'testing', 'qa', 'playwright', 'jest', 'vitest'),
  category(
    'performance',
    'Performance',
    'optimization',
    'optimizing',
    'profiling',
    'profiler',
    'benchmark',
  ),
  category('security', 'Security', 'audit', 'sast', 'vulnerability'),
  category(
    'deployment',
    'Deployment & releases',
    'deploy',
    'deployment',
    'release',
    'app-store',
    'testflight',
    'ci-cd',
    'distribution',
  ),
  category(
    'data',
    'Data & databases',
    'database',
    'databases',
    'sql',
    'postgres',
    'sqlite',
    'firebase',
    'firestore',
    'supabase',
    'tanstack-query',
    'react-query',
    'data-fetching',
  ),
  category('email', 'Email', 'resend', 'react-email'),
  category('payments', 'Payments', 'stripe', 'revenuecat', 'subscriptions'),
  category(
    'observability',
    'Monitoring & debugging',
    'sentry',
    'monitoring',
    'logging',
    'debug',
    'debugging',
    'crash',
  ),
  category('accessibility', 'Accessibility', 'a11y'),
  category(
    'workflow',
    'Developer workflow',
    'workflow',
    'planning',
    'git',
    'github',
    'review',
    'cli',
    'documentation',
  ),
  category('ai', 'AI & agents', 'ai', 'llm', 'ollama', 'agents', 'prompt'),
];
export interface Classification {
  platforms: string[];
  technologies: string[];
  topics: string[];
}
export type ClassificationAxis = keyof Classification;
export const classificationPrefixes = {
  platforms: 'platform:',
  technologies: 'technology:',
  topics: 'topic:',
} as const;
export function foldSearch(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('ı', 'i');
}
function tokens(value: string): string {
  return ` ${foldSearch(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}
const normalizedAliases = new WeakMap<Category, string[]>();
function matches(text: string, definition: Category): boolean {
  let aliases = normalizedAliases.get(definition);
  if (!aliases) {
    aliases = definition.aliases.map(tokens);
    normalizedAliases.set(definition, aliases);
  }
  return aliases.some((alias) => text.includes(alias));
}
export function isClassificationTag(tag: string): boolean {
  return Object.values(classificationPrefixes).some((prefix) => tag.startsWith(prefix));
}
function explicit(
  tags: string[],
  axis: ClassificationAxis,
  definitions: Category[],
): string[] | undefined {
  const prefix = classificationPrefixes[axis];
  const values = tags
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => tag.slice(prefix.length));
  return values.length
    ? definitions.filter((item) => values.includes(item.id)).map((item) => item.id)
    : undefined;
}
function withParents(values: string[]): string[] {
  const result = new Set(values);
  if (result.has('ios') || result.has('android')) result.add('mobile');
  if (result.has('macos')) result.add('desktop');
  return [...result];
}
export function classifyEntry(entry: Pick<Entry, 'name' | 'tags'>): Classification {
  const text = tokens(
    `${entry.name} ${entry.tags.filter((tag) => !isClassificationTag(tag)).join(' ')}`,
  );
  const detectedTech = technologies.filter((item) => matches(text, item)).map((item) => item.id);
  // React Native alone must not become a web classification just because its name contains React.
  const native = detectedTech.includes('react-native') || detectedTech.includes('expo');
  const tech =
    explicit(entry.tags, 'technologies', technologies) ??
    detectedTech.filter((id) => id !== 'react' || !native || entry.tags.includes('react-web'));
  const detectedPlatforms = platforms.filter((item) => matches(text, item)).map((item) => item.id);
  if (native) detectedPlatforms.push('mobile', 'ios', 'android');
  if (
    tech.some((id) => ['nextjs', 'vue', 'svelte', 'astro', 'react-email'].includes(id)) ||
    tech.includes('react')
  )
    detectedPlatforms.push('web');
  if (tech.some((id) => ['hono', 'express', 'fastify', 'cloudflare'].includes(id)))
    detectedPlatforms.push('backend');
  if (tech.includes('swiftui')) {
    if (!detectedPlatforms.includes('macos')) detectedPlatforms.push('ios');
    if (!detectedPlatforms.includes('ios')) detectedPlatforms.push('macos');
  }
  if (tech.includes('compose')) detectedPlatforms.push('android');
  return {
    platforms: withParents(explicit(entry.tags, 'platforms', platforms) ?? detectedPlatforms),
    technologies: tech,
    topics:
      explicit(entry.tags, 'topics', topics) ??
      topics.filter((item) => matches(text, item)).map((item) => item.id),
  };
}
