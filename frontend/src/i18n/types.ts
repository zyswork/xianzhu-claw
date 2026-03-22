export type TranslationMap = { [key: string]: string | TranslationMap }
export type Locale = 'zh-CN' | 'en'
export const SUPPORTED_LOCALES: readonly Locale[] = ['zh-CN', 'en'] as const
export const LOCALE_LABELS: Record<Locale, string> = { 'zh-CN': '中文', 'en': 'English' }
export const DEFAULT_LOCALE: Locale = 'zh-CN'
