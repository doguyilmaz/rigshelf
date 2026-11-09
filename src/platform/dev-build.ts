import { hash } from '../core/safety';

export async function devBuild(root: string, enabled = process.env.RIGSHELF_DEV === '1') {
  if (!enabled) return { enabled: false as const };
  try {
    const html = await Bun.file(`${root}/index.html`).text();
    if (!html.includes('</html>')) return { enabled: true as const, building: true as const };
    const assets = [...html.matchAll(/<script[^>]*\ssrc="(\/assets\/[^"]+)"/g)]
      .map((value) => value[1]!)
      .sort();
    return { enabled: true as const, fingerprint: hash(html), assets };
  } catch {
    return { enabled: true as const, building: true as const };
  }
}
