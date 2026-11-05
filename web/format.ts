export const PAGE_SIZE = 40;
export const countText = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count.toLocaleString('en')} ${count === 1 ? singular : plural}`;
