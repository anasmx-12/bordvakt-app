'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Language, useSettings } from '../settings';
import sv, { Key } from './sv';
import { languagesVersion, loadLanguage, subscribeLanguages, translate } from './core';

export type { Key };
export { translate, loadLanguage };

/** Språken i Inställningar, med namnet på språket självt. */
export const LANGUAGES: { code: Language; name: string; english: string }[] = [
  { code: 'sv', name: 'Svenska', english: 'Swedish' },
  { code: 'en', name: 'English', english: 'English' },
  { code: 'zh', name: '中文', english: 'Chinese' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi' },
  { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'ar', name: 'العربية', english: 'Arabic' },
  { code: 'fr', name: 'Français', english: 'French' },
  { code: 'bn', name: 'বাংলা', english: 'Bengali' },
  { code: 'pt', name: 'Português', english: 'Portuguese' },
  { code: 'ru', name: 'Русский', english: 'Russian' },
  { code: 'ur', name: 'اردو', english: 'Urdu' },
  { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'de', name: 'Deutsch', english: 'German' },
  { code: 'ja', name: '日本語', english: 'Japanese' },
  { code: 'tr', name: 'Türkçe', english: 'Turkish' },
  { code: 'ko', name: '한국어', english: 'Korean' },
];

export type TFunction = (key: Key, vars?: Record<string, string | number>) => string;

/** t('nav.dining') → texten på enhetens valda språk. */
export function useT(): TFunction {
  const { language } = useSettings();
  return useTranslate(language);
}

/** t() för ett visst språk. Hämtar språket och ritar om sidan när det har kommit. */
export function useTranslate(language: Language): TFunction {
  useEffect(() => {
    loadLanguage(language);
  }, [language]);
  const version = useSyncExternalStore(subscribeLanguages, languagesVersion, () => 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version: ny t() när språket har hämtats
  return useCallback((key, vars) => translate(language, key, vars), [language, version]);
}

// AI-motorn sparar förklaringar på svenska i databasen. De översätts här.
const ISSUE_KEYS = (Object.keys(sv) as Key[]).filter((k) => k.startsWith('issue.'));

/** Översätter en svensk förklaring från AI-motorn, annars visas den som den är. */
export function translateIssue(t: TFunction, text: string | null | undefined): string {
  if (!text) return '';
  const key = ISSUE_KEYS.find((k) => sv[k] === text);
  return key ? t(key) : text;
}

/** Datum på valt språk, t.ex. "5 november 2026". */
export function useFormatDate() {
  const { language } = useSettings();
  return useCallback(
    (iso: string | null | undefined) =>
      iso ? new Date(iso).toLocaleDateString(language, { day: 'numeric', month: 'long', year: 'numeric' }) : '–',
    [language]
  );
}
