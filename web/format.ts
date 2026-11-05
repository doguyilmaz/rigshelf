import { getLocale, t } from './i18n';
export const PAGE_SIZE = 40;
export const countText = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count.toLocaleString(getLocale())} ${t(getLocale() === 'tr' || count === 1 ? singular : plural)}`;
