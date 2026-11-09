import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

await sharp(await readFile(new URL('../public/social.svg', import.meta.url)))
  .png()
  .toFile(new URL('../public/social.png', import.meta.url).pathname);
