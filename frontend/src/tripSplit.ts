// Pure helpers for trip bill splitting, shared by the screens and tested with `node --test`
// (type-only imports, so it runs without the app). The server (backend/split) has the final say; this
// mirrors its rules for the live preview in the bill form. Texts are translation keys: the caller
// translates them (the app with t(), the tests with locales/th.ts).
import type { TKey } from './i18n';

export type Mode = 'equal' | 'amount' | 'ratio';

export type Params = Record<string, string | number>;
/** t() from i18n, passed in so this file needs nothing from the app at run time. */
export type Translate = (key: TKey, params?: Params) => string;
/** Why a split is not possible, as a translation key and its values. */
export type SplitError = { key: TKey; params?: Params };

/** Baht (as typed) to satang; NaN when not a number. */
export function toSatang(baht: string | number): number {
  const n = typeof baht === 'number' ? baht : Number(String(baht).replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/** Satang to "1,234.56". */
export function bahtText(satang: number): string {
  const sign = satang < 0 ? '-' : '';
  const abs = Math.abs(Math.round(satang));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Splits a bill (satang) like the server: equal by default; 'amount' takes each value in satang and
 * must add up; 'ratio' splits by weight. Satang left over go to the payer when they share the bill,
 * otherwise to the first person listed. Returns shares in the order given, or an error to translate.
 */
export function shares(
  amount: number,
  payer: number,
  mode: Mode,
  parts: { member: number; value: number }[],
): { shares: number[] } | { error: SplitError } {
  if (!(amount > 0)) return { error: { key: 'split.amountPositive' } };
  if (parts.length === 0) return { error: { key: 'split.noMembers' } };
  let out: number[];
  if (mode === 'amount') {
    if (parts.some((p) => !(p.value >= 0))) return { error: { key: 'split.negative' } };
    const sum = parts.reduce((s, p) => s + p.value, 0);
    if (sum !== amount) return { error: { key: 'split.mismatch', params: { sum: bahtText(sum), amount: bahtText(amount) } } };
    return { shares: parts.map((p) => p.value) };
  } else if (mode === 'ratio') {
    if (parts.some((p) => !(p.value > 0) || !Number.isInteger(p.value))) return { error: { key: 'split.badRatio' } };
    const total = parts.reduce((s, p) => s + p.value, 0);
    out = parts.map((p) => Math.floor((amount * p.value) / total));
  } else {
    const each = Math.floor(amount / parts.length);
    out = parts.map(() => each);
  }
  const left = amount - out.reduce((s, v) => s + v, 0);
  const at = Math.max(0, parts.findIndex((p) => p.member === payer));
  out[at] += left;
  return { shares: out };
}

export interface SummaryForText {
  mode: 'pairwise' | 'minimal';
  total: number; // baht
  pairs: { from_name: string; to_name: string; remaining: number; status: string }[];
  transfers: { from_name: string; to_name: string; remaining: number }[];
  people: { name: string; net: number }[];
}

/** Plain-text summary to paste into a LINE group, in the language of `t`. */
export function summaryText(tripName: string, s: SummaryForText, t: Translate): string {
  const baht = (b: number) => bahtText(Math.round(b * 100));
  const rows = (s.mode === 'minimal' ? s.transfers : s.pairs.filter((p) => p.remaining > 0)).map(
    (p) => t('split.textRow', { from: p.from_name, to: p.to_name, amount: baht(p.remaining) }),
  );
  const done = s.mode === 'pairwise' ? s.pairs.filter((p) => p.status === 'paid').map((p) => t('split.textPaid', { from: p.from_name, to: p.to_name })) : [];
  const nets = s.people.map((p) => `${p.name} ${p.net > 0 ? '+' : ''}${baht(p.net)}`);
  return [
    t('split.textTitle', { name: tripName }),
    t('split.textTotal', { amount: baht(s.total) }),
    '',
    rows.length ? t('split.textWho') : t('split.textAllPaid'),
    ...rows,
    ...(done.length ? ['', ...done] : []),
    '',
    t('split.textNets', { nets: nets.join(', ') }),
  ].join('\n');
}
