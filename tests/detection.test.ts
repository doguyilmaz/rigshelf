import { afterEach, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { detectProject } from '../src/core/detect';
import { matchingPreset } from '../src/core/recommend';
import { fixture } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
async function setup() {
  const value = await fixture();
  cleanups.push(value.cleanup);
  return value;
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test('distinguishes macOS Swift packages from mobile Swift apps', async () => {
  const { project } = await setup();
  await Bun.write(
    join(project, 'Package.swift'),
    '// swift-tools-version: 6.0\nplatforms: [.macOS(.v15)]',
  );
  const mac = await detectProject(project);
  expect(matchingPreset(mac)).toBe('macos');
  expect(mac.stacks).not.toContain('ios');
  await Bun.write(
    join(project, 'Package.swift'),
    '// swift-tools-version: 6.0\nplatforms: [.iOS(.v18)]',
  );
  expect(matchingPreset(await detectProject(project))).toBe('ios');
});
test('distinguishes Android Gradle apps from Kotlin JVM services', async () => {
  const { project } = await setup();
  await Bun.write(
    join(project, 'build.gradle.kts'),
    'plugins { kotlin("jvm") }\nimplementation("io.ktor:ktor-server-core")',
  );
  const server = await detectProject(project);
  expect(matchingPreset(server)).toBe('kotlin');
  expect(server.stacks).not.toContain('android');
  await Bun.write(
    join(project, 'build.gradle.kts'),
    'plugins { id("com.android.application"); kotlin("android") }',
  );
  expect(matchingPreset(await detectProject(project))).toBe('android');
});
test('combines bounded workspace manifests into one project and surfaces malformed manifests', async () => {
  const { project } = await setup();
  await mkdir(join(project, 'apps/mobile'), { recursive: true });
  await mkdir(join(project, 'services/api'), { recursive: true });
  await Bun.write(join(project, 'package.json'), '{invalid');
  await Bun.write(
    join(project, 'apps/mobile/package.json'),
    JSON.stringify({ dependencies: { expo: '56', 'react-native': '0.85' } }),
  );
  await Bun.write(
    join(project, 'services/api/package.json'),
    JSON.stringify({ dependencies: { hono: '4', 'better-auth': '1' } }),
  );
  const detected = await detectProject(project);
  expect(detected.workspaces).toHaveLength(2);
  expect(detected.dependencies).toContain('better-auth');
  expect(detected.stacks).toContain('hono');
  expect(detected.warnings).toHaveLength(1);
  expect(matchingPreset(detected)).toBe('expo');
});
test('explicit CLI manifests select terminal guidance across Go, Swift and JavaScript', async () => {
  const go = await setup();
  await Bun.write(
    join(go.project, 'go.mod'),
    'module example/tool\nrequire github.com/spf13/cobra v1.9.0\n',
  );
  expect(matchingPreset(await detectProject(go.project))).toBe('cli');
  const swift = await setup();
  await Bun.write(
    join(swift.project, 'Package.swift'),
    'platforms: [.macOS(.v15)]\ndependencies: [.package(url: "https://github.com/apple/swift-argument-parser", from: "1.0.0")]',
  );
  expect(matchingPreset(await detectProject(swift.project))).toBe('cli');
  const js = await setup();
  await Bun.write(
    join(js.project, 'package.json'),
    JSON.stringify({ name: 'tool', bin: './cli.js' }),
  );
  expect(matchingPreset(await detectProject(js.project))).toBe('cli');
});
