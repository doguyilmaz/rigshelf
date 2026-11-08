import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { readText } from './detect';
import { compareInventories } from './machine-compare';
import { machineDoctor } from './machine-doctor';
import { buildMachineInventory, inventoryRoots } from './machine-inventory';
import {
  HOST_ALIAS,
  type RemoteRunner,
  remoteApply,
  remoteDoctor,
  remoteInventory,
  remotePrepare,
} from './machine-ssh';
import { buildSyncRequest } from './machine-sync';
import type { Store } from './store';

const gitHosts = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);
const MAX_SSH_CONFIG_BYTES = 1024 * 1024;
const Alias = z.string().regex(HOST_ALIAS);
const SyncInput = z.object({
  alias: Alias,
  memory: z.array(z.string().min(1).max(300)).max(300).default([]),
  replaceDirectives: z.boolean().default(false),
  localFiles: z.boolean().default(true),
  globalGuidance: z.boolean().default(false),
  globalSettings: z.boolean().default(false),
  globalSkills: z.boolean().default(false),
});
const ApplyInput = z.object({ alias: Alias, planIds: z.array(z.string().uuid()).min(1).max(600) });

export function sshHostAliases(config: string): string[] {
  const aliases: string[] = [];
  for (const line of config.split('\n')) {
    const names =
      line
        .match(/^\s*host\s+(.+)$/i)?.[1]
        ?.trim()
        .split(/\s+/) ?? [];
    for (const alias of names)
      if (
        !/[*?!]/.test(alias) &&
        HOST_ALIAS.test(alias) &&
        !gitHosts.has(alias.toLowerCase()) &&
        !aliases.includes(alias)
      )
        aliases.push(alias);
  }
  return aliases;
}

export async function machineRoute(
  store: Store,
  method: string,
  action: string | undefined,
  input: unknown,
  run?: RemoteRunner,
  home = homedir(),
): Promise<unknown> {
  if (method === 'GET' && !action) {
    const config = await readText(join(home, '.ssh/config'), MAX_SSH_CONFIG_BYTES).catch(() => '');
    return { hosts: sshHostAliases(config || '') };
  }
  if (method !== 'POST') return;
  if (action === 'compare') {
    const { alias } = z.object({ alias: Alias }).parse(input);
    const [local, remote, there] = await Promise.all([
      buildMachineInventory({ home, roots: await inventoryRoots(store) }),
      remoteInventory(alias, { run }),
      remoteDoctor(alias, { run }),
    ]);
    const here = machineDoctor();
    return {
      doctor: { here, there, sameVersion: here.rigshelf === there.rigshelf },
      report: compareInventories(local, remote),
    };
  }
  if (action === 'sync') {
    const { alias, memory, replaceDirectives, ...scope } = SyncInput.parse(input);
    const sync = await buildSyncRequest(store, await inventoryRoots(store), {
      memory,
      home,
      ...scope,
    });
    const prepared = await remotePrepare(alias, sync.request, { replaceDirectives, run });
    return { prepared, skipped: sync.skipped, withheld: sync.withheld };
  }
  if (action === 'apply') {
    const { alias, planIds } = ApplyInput.parse(input);
    const results = [];
    for (const planId of planIds)
      results.push({ planId, ...(await remoteApply(alias, planId, { run })) });
    return { results };
  }
}
