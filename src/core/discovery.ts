import { z } from 'zod';
import { hash, now, redact } from './safety';
import type { Store } from './store';

export interface Discovery {
  id: string;
  query: string;
  checkedAt: string;
  skills: { name: string; slug: string; source: string; installs: number; url: string }[];
}
const SearchResponse = z.object({
  skills: z
    .array(
      z.object({
        id: z.string().max(500),
        name: z.string().max(200),
        source: z.string().max(200).default(''),
        installs: z.number().min(0).default(0),
      }),
    )
    .max(1000),
});
export async function discoverSkills(store: Store, raw: unknown): Promise<Discovery> {
  const query = z.object({ query: z.string().trim().min(2).max(100) }).parse(raw).query;
  if (redact(query) !== query)
    throw new Error(
      'Search with public technology terms; keep credentials and private project details out of discovery queries.',
    );
  const response = await fetch(
    `https://skills.sh/api/search?${new URLSearchParams({ q: query })}`,
    {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
    },
  );
  if (!response.ok)
    throw new Error(`Skill directory returned HTTP ${response.status}. Try again later.`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty directory response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 1024 * 1024) {
      await reader.cancel();
      throw new Error('Directory response exceeded 1 MiB.');
    }
    chunks.push(part.value);
  }
  const parsed = SearchResponse.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  const skills = parsed.skills
    .filter(
      (skill) =>
        /^[\w.-]+\/[\w.-]+$/.test(skill.source) &&
        !skill.source.split('/').some((part) => part === '.' || part === '..') &&
        /^[\w./-]+$/.test(skill.id),
    )
    .slice(0, 50)
    .map((skill) => ({
      name: skill.name,
      slug: skill.id,
      source: skill.source,
      installs: skill.installs,
      url: `https://skills.sh/${skill.id.split('/').map(encodeURIComponent).join('/')}`,
    }));
  const result = {
    id: `discovery-${hash(query.toLowerCase()).slice(0, 20)}`,
    query,
    checkedAt: now(),
    skills,
  };
  store.put('discovery', result);
  store.event(
    'discovery.completed',
    `${query}: ${skills.length} directory suggestions. Popularity is not a security review.`,
  );
  return result;
}
