/**
 * i18next setup — chunk 89.
 *
 * Korean is the default + fallback. English secondary. Locale persists
 * to localStorage; user can switch from Settings → 일반 (future tab).
 *
 * Why i18next:
 * - Battle-tested, type-safe with TypeScript when keys are constant
 *   union from `LocaleKey`.
 * - Pluralization / interpolation if needed later (currently flat).
 * - React hook + provider integration via react-i18next.
 *
 * Inline imports of locale files (no http backend) — Electron renderer
 * loads them statically with the bundle.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { ko, type LocaleKey } from './locales/ko';

const STORAGE_KEY = 'ahwp:locale';

function loadInitialLocale(): 'ko' | 'en' {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'ko' || v === 'en') return v;
  } catch {
    /* localStorage may throw under hardened CSP */
  }
  // Default to user's OS preference if it starts with 'en', otherwise ko.
  if (
    typeof navigator !== 'undefined' &&
    navigator.language?.startsWith('en')
  ) {
    return 'en';
  }
  return 'ko';
}

void i18n.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en },
  },
  lng: loadInitialLocale(),
  fallbackLng: 'ko',
  // Flat keys — disable nested namespace traversal so `app.title` stays
  // a single key rather than implying `app.title` lookup chain.
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false }, // React already escapes
});

export function setLocale(locale: 'ko' | 'en'): void {
  void i18n.changeLanguage(locale);
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export function currentLocale(): 'ko' | 'en' {
  return (i18n.language === 'en' ? 'en' : 'ko') as 'ko' | 'en';
}

export type { LocaleKey };
export default i18n;
