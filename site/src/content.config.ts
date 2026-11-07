import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const docs = defineCollection({
  loader: glob({ pattern: '*.md', base: './.generated/docs' }),
  schema: z.object({ title: z.string(), description: z.string(), group: z.string() }),
});

export const collections = { docs };
