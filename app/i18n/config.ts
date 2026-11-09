export const locales = ['zh-CN'] as const;
export type Locale = (typeof locales)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-CN': '简体中文',
};

export const defaultLocale: Locale = 'zh-CN';

export const i18n = {
  locales,
  defaultLocale,
  localePrefix: 'as-needed',
};
