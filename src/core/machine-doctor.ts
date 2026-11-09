import { statfs } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { VERSION } from '../version';
import { readKit } from './kit';
import { readLocalBytes } from './local-files';
import { machineProjects } from './machine-inventory';
import type { Store } from './store';

const harnessCommands: Record<string, string> = {
  claude: 'claude',
  codex: 'codex',
  kiro: 'kiro-cli',
  gemini: 'gemini',
  opencode: 'opencode',
  antigravity: 'agy',
  grok: 'grok',
};
const LOW_DISK_BYTES = 1024 ** 3;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_CODEX_CONFIG_BYTES = 1024 * 1024;
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const ProjectCheckSchema = z.object({
  name: z.string().max(255),
  missingEnv: z.array(z.string().max(100)).max(200),
  codexTrusted: z.boolean().optional(),
});
const DoctorSchema = z.object({
  rigshelf: z.string().max(50),
  platform: z.string().max(50),
  harnesses: z.record(z.string().max(40), z.boolean()),
  time: z.number().optional(),
  diskFree: z.number().optional(),
  projects: z.array(ProjectCheckSchema).max(300).optional(),
});
export type MachineDoctor = z.infer<typeof DoctorSchema>;

export function parseMachineDoctor(text: string): MachineDoctor {
  return DoctorSchema.parse(z.object({ here: z.unknown() }).parse(JSON.parse(text)).here);
}

/** Project paths that Codex trusts, read from `[projects."<path>"]` tables; values other than trust are not read. */
async function codexTrusted(home: string): Promise<Set<string>> {
  const text = await readLocalBytes(join(home, '.codex/config.toml'), MAX_CODEX_CONFIG_BYTES)
    .then((bytes) => bytes.toString('utf8'))
    .catch(() => '');
  const trusted = new Set<string>();
  for (const match of text.matchAll(
    /^\[projects\."((?:\\.|[^"\\])*)"\]\s*\n(?:[^[\n][^\n]*\n|\n)*?\s*trust_level\s*=\s*"trusted"/gm,
  ))
    trusted.add(match[1]!.replace(/\\(.)/g, '$1'));
  return trusted;
}

/** Each project with a Rigshelf kit: MCP environment names that are not set, and Codex trust when Codex is used. */
async function projectChecks(store: Store, roots: string[], home: string) {
  const trusted = await codexTrusted(home);
  const checks: z.infer<typeof ProjectCheckSchema>[] = [];
  for (const project of await machineProjects(roots)) {
    const kit = await readKit(project.path).catch(() => undefined);
    if (!kit) continue;
    const names = new Set<string>();
    for (const { id } of kit.entries) {
      const entry = store.entry(id);
      if (entry?.kind === 'mcp')
        for (const match of JSON.stringify(entry.body).matchAll(PLACEHOLDER)) names.add(match[1]!);
    }
    checks.push({
      name: project.name,
      missingEnv: [...names].filter((name) => !process.env[name]).sort(),
      ...(kit.providers.includes('codex') ? { codexTrusted: trusted.has(project.path) } : {}),
    });
  }
  return checks;
}

export async function machineDoctor(
  options: { store?: Store; roots?: string[]; home?: string } = {},
): Promise<MachineDoctor> {
  const home = options.home ?? homedir();
  const disk = await statfs(home).catch(() => undefined);
  return {
    rigshelf: VERSION,
    platform: `${process.platform}-${process.arch}`,
    harnesses: Object.fromEntries(
      Object.entries(harnessCommands).map(([harness, command]) => [
        harness,
        Boolean(Bun.which(command)),
      ]),
    ),
    time: Date.now(),
    ...(disk ? { diskFree: disk.bavail * disk.bsize } : {}),
    ...(options.store && options.roots
      ? { projects: await projectChecks(options.store, options.roots, home) }
      : {}),
  };
}

/** Plain findings for the other machine besides its version; `checkedAt` is this machine's clock when the answer arrived. */
export function doctorIssues(there: MachineDoctor, checkedAt = Date.now()) {
  const issues: string[] = [];
  if (there.diskFree !== undefined && there.diskFree < LOW_DISK_BYTES)
    issues.push(`Less than 1 GiB free there (${Math.floor(there.diskFree / 1024 ** 2)} MiB).`);
  if (there.time !== undefined && Math.abs(there.time - checkedAt) > CLOCK_SKEW_MS)
    issues.push(
      `Clocks differ by ${Math.round(Math.abs(there.time - checkedAt) / 60000)} minutes.`,
    );
  for (const project of there.projects ?? []) {
    if (project.missingEnv.length)
      issues.push(
        `${project.name}: set ${project.missingEnv.join(', ')} there for its MCP servers.`,
      );
    if (project.codexTrusted === false)
      issues.push(`${project.name}: Codex does not trust this project there; trust it in Codex.`);
  }
  return issues;
}
