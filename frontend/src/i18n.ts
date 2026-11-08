import { loadLangPref, saveLangPref } from './langStore';
import { en } from './locales/en';
import { th } from './locales/th';

// Language: chosen once at startup like the theme (texts are read at import time); changing it reloads the app.
export type Lang = 'th' | 'en';
export type TKey = keyof typeof th;

const LOCALES: Record<Lang, Record<TKey, string>> = { th, en };

export const LANG: Lang = loadLangPref() === 'en' ? 'en' : 'th';
const dict = LOCALES[LANG];

/** t('key', { n: 3 }) -> the text in the current language with {n} filled in (Thai if a key is missing). */
export function t(key: TKey, params?: Record<string, string | number>): string {
  const text = dict[key] ?? th[key] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Name of a shared row by its code: t('category.' + code); the name from the database when there is no key. */
export function tCode(group: 'category' | 'accountType', code: string | null | undefined, name: string): string {
  const key = `${group}.${code}`;
  return code && key in th ? t(key as TKey) : name;
}

/** Text around the placeholders, for a sentence with a styled value inside: 'a {x} b' -> ['a ', ' b']. */
export const tParts = (key: TKey) => t(key).split(/\{\w+\}/);

/** Lists stored as "a|b|c" (month names). */
export const tList = (key: TKey) => t(key).split('|');

export function setLang(lang: Lang) {
  const d = LOCALES[lang];
  saveLangPref(lang, d['lang.changedTitle'], d['lang.changedBody']);
}
