// Pure helpers for trip bill splitting, shared by the screens and tested with `node --test`
// (no imports, so it runs without the app). The server (backend/split) has the final say; this
// mirrors its rules for the live preview in the bill form.

export type Mode = 'equal' | 'amount' | 'ratio';

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
 * otherwise to the first person listed. Returns shares in the order given, or an error message.
 */
export function shares(
  amount: number,
  payer: number,
  mode: Mode,
  parts: { member: number; value: number }[],
): { shares: number[] } | { error: string } {
  if (!(amount > 0)) return { error: 'ยอดบิลต้องมากกว่า 0' };
  if (parts.length === 0) return { error: 'ต้องเลือกคนหารอย่างน้อย 1 คน' };
  let out: number[];
  if (mode === 'amount') {
    if (parts.some((p) => !(p.value >= 0))) return { error: 'ยอดของแต่ละคนต้องไม่ติดลบ' };
    const sum = parts.reduce((s, p) => s + p.value, 0);
    if (sum !== amount) return { error: `ยอดที่แบ่งรวมกันได้ ${bahtText(sum)} ไม่เท่ากับยอดบิล ${bahtText(amount)}` };
    return { shares: parts.map((p) => p.value) };
  } else if (mode === 'ratio') {
    if (parts.some((p) => !(p.value > 0) || !Number.isInteger(p.value))) return { error: 'สัดส่วนต้องเป็นจำนวนเต็มที่มากกว่า 0' };
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

/** Plain-text summary to paste into a LINE group. */
export function summaryText(tripName: string, s: SummaryForText): string {
  const baht = (b: number) => bahtText(Math.round(b * 100));
  const rows = (s.mode === 'minimal' ? s.transfers : s.pairs.filter((p) => p.remaining > 0)).map(
    (p) => `• ${p.from_name} โอนให้ ${p.to_name} ${baht(p.remaining)} บาท`,
  );
  const done = s.mode === 'pairwise' ? s.pairs.filter((p) => p.status === 'paid').map((p) => `✓ ${p.from_name} → ${p.to_name} จ่ายครบแล้ว`) : [];
  const nets = s.people.map((p) => `${p.name} ${p.net > 0 ? '+' : ''}${baht(p.net)}`);
  return [
    `🧾 สรุปค่าใช้จ่ายทริป "${tripName}"`,
    `ยอดรวม ${baht(s.total)} บาท`,
    '',
    rows.length ? 'ใครต้องโอนให้ใคร:' : 'ทุกคนจ่ายครบแล้ว 🎉',
    ...rows,
    ...(done.length ? ['', ...done] : []),
    '',
    `ยอดคงเหลือ (+ ได้รับ / − ต้องจ่าย): ${nets.join(', ')}`,
  ].join('\n');
}
