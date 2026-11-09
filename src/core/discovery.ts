import { z } from 'zod';
import { readBounded } from './bounded-read';
import { hash, now, redact } from './safety';
import type { Store } from './store';

const MAX_DIRECTORY_RESPONSE_BYTES = 1024 * 1024;

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
  if (!response.body) throw new Error('Empty directory response');
  const body = await readBounded(
    response.body,
    MAX_DIRECTORY_RESPONSE_BYTES,
    () => new Error('Directory response exceeded 1 MiB.'),
  );
  const parsed = SearchResponse.parse(JSON.parse(body.toString('utf8')));
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
