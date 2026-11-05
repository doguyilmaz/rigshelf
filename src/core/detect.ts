import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { instructionNames } from './inventory-paths';
import type { Project } from './model';
import { hash, now } from './safety';

export { ignoredDirectories } from './inventory-paths';

import { ignoredDirectories } from './inventory-paths';
export async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}
export async function readText(path: string, limit = 512 * 1024): Promise<string | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return;
  if (file.size > limit) throw new Error(`File exceeds ${limit} bytes: ${path}`);
  return file.text();
}
interface Facts {
  stacks: Set<string>;
  dependencies: Set<string>;
  warnings: string[];
  workspaces: NonNullable<Project['workspaces']>;
}
const packageStacks: Record<string, string[]> = {
  expo: ['expo', 'react-native', 'mobile', 'ios', 'android'],
  'react-native': ['react-native', 'mobile', 'ios', 'android'],
  react: ['react'],
  next: ['nextjs', 'web'],
  astro: ['astro', 'web'],
  vue: ['vue', 'web'],
  svelte: ['svelte', 'web'],
  vite: ['web'],
  hono: ['hono', 'backend'],
  express: ['backend'],
  fastify: ['backend'],
  elysia: ['backend'],
  'better-auth': ['better-auth'],
  '@clerk/nextjs': ['clerk'],
  firebase: ['firebase'],
  '@tanstack/react-query': ['react-query'],
  '@sentry/react-native': ['sentry'],
  typescript: ['typescript'],
  wrangler: ['cloudflare'],
};
function addStacks(facts: Facts, values: string[]): void {
  for (const value of values) facts.stacks.add(value);
}

async function readPackage(path: string, facts: Facts): Promise<string[]> {
  const text = await readText(join(path, 'package.json'));
  if (!text) return [];
  try {
    const manifest = JSON.parse(text) as Record<string, unknown>;
    const names = Object.keys({
      ...(typeof manifest.dependencies === 'object' ? manifest.dependencies : {}),
      ...(typeof manifest.devDependencies === 'object' ? manifest.devDependencies : {}),
    });
    const localStacks = new Set<string>(['javascript']);
    for (const name of names) {
      facts.dependencies.add(name);
      for (const stack of packageStacks[name] || []) localStacks.add(stack);
    }
    if (await exists(join(path, 'tsconfig.json'))) localStacks.add('typescript');
    if (localStacks.has('react') && !localStacks.has('react-native')) localStacks.add('web');
    if ((await exists(join(path, 'bun.lock'))) || (await exists(join(path, 'bun.lockb'))))
      localStacks.add('bun');
    if (manifest.bin && ['object', 'string'].includes(typeof manifest.bin)) localStacks.add('cli');
    addStacks(facts, [...localStacks]);
    return [...localStacks];
  } catch {
    facts.warnings.push(
      `Could not parse ${basename(path)}/package.json. Use requirements or a preset to guide setup.`,
    );
    return [];
  }
}

async function readWorkspaces(path: string, facts: Facts): Promise<void> {
  const parents = ['apps', 'packages', 'services'];
  const candidates = new Set(['web', 'api', 'server', 'backend', 'frontend', 'app', 'site', 'src']);
  for (const parent of parents)
    for (const entry of await readdir(join(path, parent), { withFileTypes: true }).catch(
      () => [],
    )) {
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name))
        candidates.add(`${parent}/${entry.name}`);
    }
  for (const relativePath of [...candidates].slice(0, 64)) {
    const child = join(path, relativePath);
    const stacks = await readPackage(child, facts);
    const go = await goStacks(child);
    stacks.push(...go);
    addStacks(facts, go);
    if (stacks.length) facts.workspaces.push({ name: relativePath, path: relativePath, stacks });
  }
}

async function readApple(path: string, names: string[], facts: Facts): Promise<void> {
  const packageText = (await readText(join(path, 'Package.swift'))) || '';
  const projects = names.filter((name) => name.endsWith('.xcodeproj'));
  let projectText = '';
  for (const name of projects.slice(0, 8))
    projectText += (await readText(join(path, name, 'project.pbxproj'), 2 * 1024 * 1024)) || '';
  if (!packageText && !projects.length) return;
  if (/swift-argument-parser|ArgumentParser/.test(packageText)) facts.stacks.add('cli');
  if (packageText || /\.swift\b|SWIFT_VERSION/.test(projectText)) facts.stacks.add('swift');
  else if (/\.[mh]\b/.test(projectText)) facts.stacks.add('objective-c');
  if (
    /\.macOS\b/.test(packageText) ||
    /SDKROOT\s*=\s*macosx|SUPPORTED_PLATFORMS\s*=\s*"?macosx/.test(projectText)
  )
    facts.stacks.add('macos');
  if (
    /\.iOS\b/.test(packageText) ||
    /iphoneos|iphonesimulator|TARGETED_DEVICE_FAMILY/.test(projectText)
  )
    addStacks(facts, ['ios', 'mobile']);
}

async function readNative(path: string, facts: Facts): Promise<void> {
  const names = await readdir(path).catch(() => [] as string[]);
  await readApple(path, names, facts);
  for (const relativePath of [
    'build.gradle.kts',
    'build.gradle',
    'app/build.gradle.kts',
    'app/build.gradle',
  ]) {
    const gradle = await readText(join(path, relativePath));
    if (!gradle) continue;
    if (/kotlin|org\.jetbrains/.test(gradle)) facts.stacks.add('kotlin');
    if (/com\.android|androidTarget\(|android\s*\{/.test(gradle))
      addStacks(facts, ['android', 'mobile']);
    if (/ktor|springframework|kotlin\("jvm"\)|org\.jetbrains\.kotlin\.jvm/.test(gradle))
      addStacks(facts, ['kotlin', 'backend']);
    if (/compose\.desktop/.test(gradle)) addStacks(facts, ['kotlin', 'desktop']);
    if (/iosArm64|iosSimulatorArm64/.test(gradle)) addStacks(facts, ['ios', 'mobile']);
  }
  addStacks(facts, await goStacks(path));
  if (await exists(join(path, 'Cargo.toml'))) addStacks(facts, ['rust']);
  if (
    (await exists(join(path, 'pyproject.toml'))) ||
    (await exists(join(path, 'requirements.txt')))
  )
    addStacks(facts, ['python']);
  if (names.some((name) => /\.(?:csproj|sln|fsproj)$/.test(name)))
    addStacks(facts, ['dotnet', 'backend']);
}

async function goStacks(path: string): Promise<string[]> {
  const manifest = await readText(join(path, 'go.mod'));
  if (!manifest) return [];
  return [
    'go',
    /(?:github\.com\/(?:spf13\/cobra|urfave\/cli|charmbracelet\/(?:bubbletea|huh)))/.test(manifest)
      ? 'cli'
      : 'backend',
  ];
}

function readRequirements(requirements: string, facts: Facts): void {
  const text = requirements.toLowerCase();
  const patterns: [RegExp, string[]][] = [
    [/\bexpo\b/, ['expo', 'react-native', 'mobile', 'typescript']],
    [/react native/, ['react-native', 'mobile', 'typescript']],
    [/swiftui|\bswift\b/, ['swift']],
    [/\bios\b/, ['ios', 'mobile']],
    [/objective-c|\bobjc\b/, ['objective-c', 'ios', 'mobile']],
    [/macos|appkit/, ['swift', 'macos']],
    [/\bkotlin\b/, ['kotlin']],
    [/jetpack|\bandroid\b/, ['kotlin', 'android', 'mobile']],
    [/next\.?js/, ['nextjs', 'react', 'web', 'typescript']],
    [/\bastro\b/, ['astro', 'web']],
    [/\bweb\b|frontend/, ['web']],
    [/\bapi\b|backend|\bserver\b/, ['backend']],
    [/\bgo\b|golang/, ['go', 'backend']],
    [/\bbun\b/, ['bun', 'typescript']],
    [/\bhono\b/, ['hono', 'backend']],
    [/better-auth/, ['better-auth']],
    [/typescript|\bts\b/, ['typescript']],
    [/\bpython\b/, ['python']],
    [/\brust\b/, ['rust']],
    [/\.net|c#/, ['dotnet', 'backend']],
    [/cloudflare|workers/, ['cloudflare', 'backend']],
  ];
  for (const [pattern, values] of patterns) if (pattern.test(text)) addStacks(facts, values);
}

export async function detectProject(path: string, requirements = ''): Promise<Project> {
  const facts: Facts = { stacks: new Set(), dependencies: new Set(), warnings: [], workspaces: [] };
  await readPackage(path, facts);
  await readWorkspaces(path, facts);
  await readNative(path, facts);
  readRequirements(requirements, facts);
  const documents: string[] = [];
  for (const document of [...instructionNames, '.claude/CLAUDE.md', '.claude/MEMORY.md'])
    if (await exists(join(path, document))) documents.push(document);
  return {
    id: `project-${hash(path).slice(0, 20)}`,
    name: basename(path),
    path,
    stacks: [...facts.stacks],
    dependencies: [...facts.dependencies],
    providers: [],
    documents,
    detectedAt: now(),
    requirements,
    discovery: 'files',
    warnings: facts.warnings,
    workspaces: facts.workspaces,
  };
}

export function inferTags(name: string, source = ''): string[] {
  const tags = new Set<string>();
  const text = `${name} ${source}`.toLowerCase();
  const patterns: Record<string, RegExp> = {
    expo: /expo/,
    'react-native': /react-native|nitro|reanimated|worklet|react-navigation|legendlist|uniwind/,
    ios: /ios|swift|apple|app-store|testflight|asc-/,
    swift: /swift/,
    android: /android|kotlin|compose/,
    kotlin: /kotlin/,
    macos: /macos|appkit/,
    web: /frontend|next|react-|tailwind|web-|sonner|vercel/,
    nextjs: /next/,
    react: /react/,
    backend: /api|backend|server|cloudflare|workers|upstash|auth|hono/,
    go: /golang|go-best/,
    bun: /\bbun\b/,
    hono: /hono/,
    design: /design|ui-|animation|animate|canvas/,
    testing: /test|qa|verify/,
    security: /security|audit|sast/,
    cloudflare: /cloudflare|workers|durable|wrangler/,
    'better-auth': /better-auth/,
    firebase: /firebase/,
    clerk: /clerk/,
    sentry: /sentry/,
    'react-query': /react-query|tanstack/,
    typescript: /typescript|react|expo|next|hono|bun/,
  };
  for (const [tag, pattern] of Object.entries(patterns)) if (pattern.test(text)) tags.add(tag);
  if (tags.has('ios') || tags.has('android') || tags.has('react-native') || tags.has('expo'))
    tags.add('mobile');
  return [...tags];
}
