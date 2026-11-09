import { getCollection } from 'astro:content';

export async function GET() {
  const entries = await getCollection('docs');
  const data = entries.map((entry) => ({
    slug: entry.id,
    title: entry.data.title,
    description: entry.data.description,
    text: (entry.body || '')
      .replace(/[#*`>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 30000),
  }));
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}
