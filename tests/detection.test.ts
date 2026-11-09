import { afterEach, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { detectProject } from '../src/core/detect';
import { matchingPreset, recommend } from '../src/core/recommend';
import { fixture, sampleSkill } from './helpers';

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
test('reads packages declared by package.json workspaces and pnpm-workspace.yaml', async () => {
  const { project } = await setup();
  await Bun.write(
    join(project, 'package.json'),
    JSON.stringify({ private: true, workspaces: { packages: ['libs/*', '!libs/ignored'] } }),
  );
  await Bun.write(
    join(project, 'libs/mobile/package.json'),
    JSON.stringify({ dependencies: { expo: '56' } }),
  );
  await Bun.write(join(project, 'pnpm-workspace.yaml'), 'packages:\n  - "tools/*"\n  - docs\n');
  await Bun.write(
    join(project, 'tools/api/package.json'),
    JSON.stringify({ dependencies: { hono: '4' } }),
  );
  await Bun.write(
    join(project, 'docs/package.json'),
    JSON.stringify({ dependencies: { nuxt: '4' } }),
  );
  const detected = await detectProject(project);
  expect(detected.stacks).toEqual(expect.arrayContaining(['expo', 'hono', 'nuxt', 'vue']));
  expect(detected.workspaces?.map((workspace) => workspace.path).sort()).toEqual([
    'docs',
    'libs/mobile',
    'tools/api',
  ]);
});
test('collects Python and Go module dependencies', async () => {
  const { project } = await setup();
  await Bun.write(
    join(project, 'pyproject.toml'),
    '[project]\nname = "x"\ndependencies = ["FastAPI>=0.110", "sqlalchemy[asyncio]~=2.0"]\n\n[tool.poetry.dependencies]\npython = "^3.12"\nhttpx = "*"\n',
  );
  await Bun.write(
    join(project, 'requirements.txt'),
    '# pinned\nDjango==5.1 ; python_version>"3.10"\n-r base.txt\n',
  );
  await mkdir(join(project, 'server'));
  await Bun.write(
    join(project, 'server/go.mod'),
    'module x\n\nrequire github.com/spf13/cobra v1.8.0\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0 // indirect\n)\n',
  );
  const detected = await detectProject(project);
  expect(detected.dependencies).toEqual(
    expect.arrayContaining([
      'fastapi',
      'sqlalchemy',
      'httpx',
      'django',
      'github.com/gin-gonic/gin',
    ]),
  );
  expect(detected.dependencies).not.toContain('python');
  expect(detected.stacks).toEqual(expect.arrayContaining(['python', 'backend']));
});
test('an oversized Python manifest becomes a warning instead of failing detection', async () => {
  const { project } = await setup();
  await Bun.write(join(project, 'requirements.txt'), 'x\n'.repeat(400_000));
  const detected = await detectProject(project);
  expect(detected.stacks).toContain('python');
  expect(detected.warnings?.join('\n')).toContain('requirements.txt');
});
test('detects Unity projects instead of treating generated C# projects as a backend', async () => {
  const { project, store } = await setup();
  await Bun.write(
    join(project, 'ProjectSettings/ProjectVersion.txt'),
    'm_EditorVersion: 6000.0.30f1\n',
  );
  await Bun.write(join(project, 'Assembly-CSharp.csproj'), '<Project />');
  await Bun.write(
    join(project, 'Packages/manifest.json'),
    JSON.stringify({ dependencies: { 'com.unity.render-pipelines.universal': '17.0.3' } }),
  );
  const detected = await detectProject(project);
  expect(detected.stacks).toEqual(expect.arrayContaining(['unity', 'csharp']));
  expect(detected.stacks).not.toContain('backend');
  expect(detected.dependencies).toContain('com.unity.render-pipelines.universal');
  const unity = sampleSkill(store, 'new-unity-project');
  const api = sampleSkill(store, 'api-design');
  const selected = recommend(store, detected)
    .recommendations.filter((value) => value.selected)
    .map((value) => value.entry.id);
  expect(selected).toContain(unity.id);
  expect(selected).not.toContain(api.id);
});
test('a folder without root manifests inspects its first-level packages', async () => {
  const { project } = await setup();
  for (const name of ['mapping', 'proxies'])
    await Bun.write(
      join(project, name, 'package.json'),
      JSON.stringify({ dependencies: { 'aws-cdk-lib': '2', hono: '4' } }),
    );
  await Bun.write(
    join(project, 'node_modules/x/package.json'),
    JSON.stringify({ dependencies: { expo: '1' } }),
  );
  const detected = await detectProject(project);
  expect(detected.workspaces?.map((workspace) => workspace.path).sort()).toEqual([
    'mapping',
    'proxies',
  ]);
  expect(detected.stacks).toContain('hono');
  expect(detected.stacks).not.toContain('expo');
});
test('an AWS CDK app entry point is infrastructure, not a command-line tool', async () => {
  const { project } = await setup();
  await Bun.write(
    join(project, 'package.json'),
    JSON.stringify({
      bin: { app: 'bin/app.js' },
      dependencies: { 'aws-cdk-lib': '2', constructs: '10' },
    }),
  );
  const detected = await detectProject(project);
  expect(detected.stacks).toContain('aws-cdk');
  expect(detected.stacks).not.toContain('cli');
  expect(matchingPreset(detected)).toBe('backend');
});
