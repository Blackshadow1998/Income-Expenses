// PromptPay QR payload (Thai QR Payment / EMVCo): the text a banking app reads from a PromptPay QR.
// Kept free of React so `npm test` can run it with Node.

/** One EMVCo field: id, two-digit length, value. */
function field(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, start 0xFFFF), as four upper-case hex digits. */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Digits of a PromptPay ID, or null unless it is a mobile number (10, from 0), ID/tax number (13) or e-Wallet (15). */
export function promptPayDigits(id: string): string | null {
  const d = id.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(d)) return null;
  if (d.length === 10 && d.startsWith('0')) return d;
  if (d.length === 13 || d.length === 15) return d;
  return null;
}

/**
 * The QR text for paying `id` (mobile number, ID card / tax number or e-Wallet ID), with the amount
 * filled in when `amount` (baht) is above 0. Null for an ID that isn't a PromptPay ID.
 */
export function promptPayPayload(id: string, amount?: number): string | null {
  const d = promptPayDigits(id);
  if (!d) return null;
  // Mobile numbers go in as 0066 + the number without its leading 0 (13 digits).
  const account = d.length === 10 ? field('01', '0066' + d.slice(1)) : d.length === 13 ? field('02', d) : field('03', d);
  const withAmount = amount !== undefined && amount > 0;
  const body =
    field('00', '01') +
    field('01', withAmount ? '12' : '11') + // 12 = for one payment (amount set), 11 = reusable
    field('29', field('00', 'A000000677010111') + account) +
    field('53', '764') + // baht
    (withAmount ? field('54', amount.toFixed(2)) : '') +
    field('58', 'TH');
  const head = body + '6304';
  return head + crc16(head);
}
