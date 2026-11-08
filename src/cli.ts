#!/usr/bin/env bun
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { backupHelp, runBackupCommand } from './backup-cli';
import { readImport, setupProject, writeExport } from './cli-operations';
import { readRecord } from './core/local-files';
import { PresetSchema, ProviderSchema, RuleSchema } from './core/model';
import { approveProject } from './core/ownership';
import { filePreview, planView } from './core/plan-view';
import { executePlan } from './core/planner';
import { recoverPlan } from './core/recovery';
import { checkedProject } from './core/safety';
import { scan } from './core/scanner';
import { seed } from './core/seeds';
import { route } from './core/service';
import { Store } from './core/store';
import { checkProject, watchProject } from './core/watch';
import { machineHelp, openRemoteWorkbench, runMachineCommand } from './machine-cli';
import { serveMcp } from './mcp';
import { serveProxy } from './mcp-proxy';
import { openWorkbenchServer } from './platform/workbench-start';
import { VERSION } from './version';

const help = `Rigshelf · Project setup for coding agents

  rigshelf ui [--port 47471] [--reset-access]     Open the local web workbench
  rigshelf scan [--root /path] [--no-global]     Import actual local files; no project edits
  rigshelf catalog [query]                      Search installed library metadata
  rigshelf detect /project [--requirements text] Suggest a focused kit
  rigshelf setup /project --preset expo [--agents claude,codex] [--apply]
  rigshelf plan /project [--entries id,id] [--agents claude,codex] [--preset expo]
    Omitted --entries uses recommendations; --entries "" selects guidance only.
    --reviewed permits inspected review flags; --replace-existing preserves replacements for rollback.
  rigshelf apply <plan-id>                      Apply a reviewed plan
  rigshelf diff <plan-id> [--file relative/path] Bounded, masked file preview
  rigshelf recover <plan-id>                    Recover a verified interrupted write
  rigshelf rollback <plan-id>                   Restore the pre-setup files
  rigshelf sources                             List saved sources and evidence
  rigshelf check-source <source-id>             Check reachability / upstream commit
  rigshelf source-skills <source-id>            Discover upstream SKILL.md paths
  rigshelf import-skill <source-id> <path>      Snapshot one skill without running scripts
  rigshelf import-local /skill-folder          Snapshot SKILL.md and supporting files
  rigshelf trust <entry-id>                     Allow this exact clean snapshot in --auto mode
  rigshelf untrust <entry-id>                   Revoke automatic snapshot installation
  rigshelf automation /project on|off          Approve or revoke project automation
  rigshelf check-project /project [--auto]      Dependency-triggered recommendations
  rigshelf watch /project [--auto]              Debounced manifest watcher; Ctrl-C to stop
  rigshelf find "public technology terms"      Search skills.sh; suggestions only
  rigshelf add-source "URL / owner/repo / command" Research and register a source
  rigshelf presets / rules                     List editable presets or directives
  rigshelf save-preset / save-rule <file.json>  Save an editable library definition
    --create-only preserves existing IDs; --expect previous.json checks an update before saving.
  rigshelf archive / restore <entry-id>         Manage library visibility
  rigshelf export <file.json[.gz]>                   Portable library, presets and rules
  rigshelf import <file.json[.gz]> [--apply]         Preview import; --apply writes library only
  rigshelf mcp [--write] [--root /project]      Stdio MCP; read/plan tools by default
  rigshelf doctor                              Show local paths and provider capabilities
  rigshelf --version                           Show the installed version
  rigshelf connection --agents codex [--write --root /project]  Render MCP connection settings

RIGSHELF_DATA_DIR overrides private storage; KITFOLD_DATA_DIR remains compatible.
The default port advances when occupied. Explicit --port never moves.
Access survives restarts. --reset-access invalidates old URLs for the next server start.
${machineHelp}${backupHelp}`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      port: { type: 'string' },
      root: { type: 'string', multiple: true },
      'no-global': { type: 'boolean' },
      agents: { type: 'string' },
      entries: { type: 'string' },
      preset: { type: 'string' },
      requirements: { type: 'string' },
      apply: { type: 'boolean' },
      auto: { type: 'boolean' },
      write: { type: 'boolean' },
      reviewed: { type: 'boolean' },
      file: { type: 'string' },
      'replace-existing': { type: 'boolean' },
      limit: { type: 'string' },
      'reset-access': { type: 'boolean' },
      'create-only': { type: 'boolean' },
      expect: { type: 'string' },
      mode: { type: 'string' },
      cursor: { type: 'string' },
      'acknowledge-frozen': { type: 'boolean' },
      'remote-root': { type: 'string', multiple: true },
      manifest: { type: 'string' },
      json: { type: 'boolean' },
      on: { type: 'string' },
      attached: { type: 'boolean' },
      'public-port': { type: 'string' },
      'remote-port': { type: 'string' },
      'replace-directives': { type: 'boolean' },
      memory: { type: 'string' },
      'skip-local-files': { type: 'boolean' },
      'global-guidance': { type: 'boolean' },
      'global-settings': { type: 'boolean' },
      'global-skills': { type: 'boolean' },
    },
  });
  if (values.version) {
    process.stdout.write(`Rigshelf ${VERSION}\n`);
    return;
  }
  if (values.help) {
    process.stdout.write(help);
    return;
  }
  const [command = 'ui', subject, extra] = positionals;
  if (command === 'mcp-proxy') {
    if (!values.file) throw new Error('mcp-proxy requires --file');
    await serveProxy(values.file);
    return;
  }
  const store = new Store();
  seed(store);
  let persistent = false;
  let result: unknown;
  const required = () => {
    if (!subject) throw new Error(`${command} requires an argument. Run rigshelf --help.`);
    return subject;
  };
  try {
    switch (command) {
      case 'backup':
        result = await runBackupCommand(store, subject, extra, positionals[3], values);
        break;
      case 'machine': {
        const machine = await runMachineCommand(
          store,
          subject,
          extra,
          values,
          positionals.slice(3),
        );
        if (machine.text) process.stdout.write(machine.text);
        result = machine.result;
        break;
      }
      case 'connection':
        result = await Promise.all(
          (values.agents?.split(',') || store.settings().defaultProviders).map((provider) =>
            route(store, 'POST', 'connection', {
              provider,
              writable: values.write || false,
              projectPath: values.root?.[0] || subject || '',
            }),
          ),
        );
        break;
      case 'ui': {
        const port = values.port === undefined ? 47471 : Number(values.port);
        if (!Number.isInteger(port) || port < 1024 || port > 65535)
          throw new Error('Choose a port between 1024 and 65535.');
        if (values.on) {
          store.close();
          persistent = true;
          const remotePort =
            values['remote-port'] === undefined ? undefined : Number(values['remote-port']);
          process.exitCode = await openRemoteWorkbench(
            values.on,
            values.port === undefined ? undefined : port,
            remotePort,
          );
          break;
        }
        const publicPort =
          values['public-port'] === undefined ? undefined : Number(values['public-port']);
        if (
          publicPort !== undefined &&
          (!Number.isInteger(publicPort) || publicPort < 1024 || publicPort > 65535)
        )
          throw new Error('Choose a public port between 1024 and 65535.');
        const { server, moved } = openWorkbenchServer(
          store,
          values.port === undefined ? undefined : port,
          values['reset-access'],
          publicPort,
          values.attached ? hostname().replace(/\.local$/, '') : undefined,
        );
        persistent = true;
        let closing = false;
        const close = () => {
          if (closing) return;
          closing = true;
          process.stderr.write(
            'Closing Rigshelf. Waiting for active inventory and file operations to finish.\n',
          );
          void server
            .stop(true)
            .then(() => {
              store.close();
              process.exit(0);
            })
            .catch((error: unknown) => {
              process.stderr.write(
                `Rigshelf could not finish shutdown: ${error instanceof Error ? error.message : 'Operation failed'}\n`,
              );
              process.exit(1);
            });
        };
        process.once('SIGINT', close);
        process.once('SIGTERM', close);
        if (values.attached) {
          process.stdin.once('end', close);
          process.stdin.resume();
        }
        process.stdout.write(
          `${moved ? 'The default port was occupied; using another available local port.\n' : ''}Rigshelf is ready at ${server.accessUrl}\nPrivate data: ${store.directory}\nOpen this URL in your browser. Keep it private.\n`,
        );
        break;
      }
      case 'scan':
        result = await scan(store, { roots: values.root, globals: !values['no-global'] });
        break;
      case 'catalog':
        result = store
          .entries()
          .filter((entry) =>
            `${entry.name} ${entry.description} ${entry.tags.join(' ')}`
              .toLowerCase()
              .includes((subject || '').toLowerCase()),
          )
          .slice(0, Math.min(200, Math.max(1, Number(values.limit || 30))));
        break;
      case 'detect':
        result = await route(store, 'POST', 'detect', {
          projectPath: required(),
          requirements: values.requirements || '',
          presetId: values.preset,
        });
        break;
      case 'setup':
      case 'plan':
        result = await setupProject(store, required(), {
          providers:
            values.agents === undefined
              ? undefined
              : values.agents.split(',').map((value) => ProviderSchema.parse(value)),
          entries: values.entries,
          presetId: values.preset,
          requirements: values.requirements,
          reviewed: values.reviewed,
          replaceExisting: values['replace-existing'],
          apply: command === 'setup' && values.apply,
        });
        break;
      case 'apply':
        result = planView(await executePlan(store, required(), 'apply'));
        break;
      case 'rollback':
        result = planView(await executePlan(store, required(), 'rollback'));
        break;
      case 'recover':
        result = planView(await recoverPlan(store, required()));
        break;
      case 'diff': {
        const plan = store.get<import('./core/model').Plan>('plan', required());
        if (!plan) throw new Error('Plan not found');
        const index = values.file
          ? plan.changes.findIndex((change) => change.path === values.file)
          : Number(extra || 0);
        result = filePreview(plan, index);
        break;
      }
      case 'sources':
        result = store.sources();
        break;
      case 'check-source':
        result = await route(store, 'POST', `sources/${required()}/check`, {});
        break;
      case 'source-skills':
        result = await route(store, 'GET', `sources/${required()}/skills`, {});
        break;
      case 'import-skill':
        if (!extra) throw new Error('Provide the source SKILL.md path.');
        result = await route(store, 'POST', `sources/${required()}/import`, { path: extra });
        break;
      case 'import-local':
        result = await route(store, 'POST', 'local-import', { path: required() });
        break;
      case 'trust': {
        result = await route(store, 'POST', `trust/${required()}`, {});
        break;
      }
      case 'untrust':
        result = await route(store, 'DELETE', `trust/${required()}`, {});
        break;
      case 'automation':
        if (!['on', 'off'].includes(extra || ''))
          throw new Error('Use automation /project on|off.');
        result = await approveProject(store, await checkedProject(required()), extra === 'on');
        break;
      case 'check-project':
        result = await checkProject(store, required(), values.auto);
        break;
      case 'watch': {
        const stop = await watchProject(store, required(), values.auto);
        persistent = true;
        process.stderr.write(
          `Watching dependency manifests. ${values.auto ? 'Trusted additions enabled.' : 'Suggestions only.'}\n`,
        );
        let closing = false;
        const cleanup = () => {
          if (closing) return;
          closing = true;
          void stop()
            .then(() => {
              store.close();
              process.exit(0);
            })
            .catch(() => process.exit(1));
        };
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
        break;
      }
      case 'export':
        result = await writeExport(store, required());
        break;
      case 'import':
        result = await readImport(store, required(), Boolean(values.apply));
        break;
      case 'find':
        result = await route(store, 'POST', 'discover', { query: required() });
        break;
      case 'add-source':
        result = await route(store, 'POST', 'sources', { input: required() });
        break;
      case 'presets':
        result = store.list('preset');
        break;
      case 'rules':
        result = store.list('rule');
        break;
      case 'save-preset':
      case 'save-rule': {
        if (values['create-only'] && values.expect !== undefined)
          throw new Error('Choose --create-only or --expect, not both.');
        const resource = command === 'save-preset' ? 'presets' : 'rules';
        const schema = command === 'save-preset' ? PresetSchema : RuleSchema;
        const value = schema.parse(await readRecord(required()));
        const checked = values.expect !== undefined;
        const expected = checked ? await readRecord(values.expect!) : undefined;
        result = await route(
          store,
          checked ? 'PATCH' : values['create-only'] ? 'POST' : 'PUT',
          checked ? `${resource}/${value.id}` : resource,
          checked ? { value, expected } : value,
        );
        break;
      }
      case 'archive':
        result = await route(store, 'DELETE', `entries/${required()}`, undefined);
        break;
      case 'restore': {
        const entry = store.entry(required());
        if (!entry) throw new Error('Entry not found');
        result = await route(store, 'PATCH', `entries/${entry.id}`, {
          tags: entry.tags,
          archived: false,
        });
        break;
      }
      case 'mcp':
        await serveMcp(store, Boolean(values.write), values.root);
        persistent = true;
        break;
      case 'doctor':
        result = {
          dataDirectory: store.directory,
          runtime: Bun.version,
          entries: store.entries().length,
          projects: store.projects().length,
          roots: store.settings().roots,
          persistence: 'SQLite / schema v1',
          privacy: 'Local only; no sessions or token stores collected',
          writeMode: 'Project plans with backups and conflict checks',
        };
        break;
      default:
        throw new Error(`Unknown command: ${command}. Run rigshelf --help.`);
    }
    if (result !== undefined) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (!persistent) store.close();
  }
}
main().catch((error) => {
  process.stderr.write(`rigshelf: ${error instanceof Error ? error.message : 'Command failed'}\n`);
  process.exitCode = 1;
});
