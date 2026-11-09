// Run: node --test src/promptpay.test.mjs (Node 22 strips the TypeScript types itself).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc16, promptPayDigits, promptPayPayload } from './promptpay.ts';

test('CRC-16/CCITT-FALSE check value', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('PromptPay IDs: mobile, ID card, e-Wallet; anything else is refused', () => {
  assert.equal(promptPayDigits('081-234-5678'), '0812345678');
  assert.equal(promptPayDigits('1 2345 67890 12 3'), '1234567890123');
  assert.equal(promptPayDigits('123456789012345'), '123456789012345');
  assert.equal(promptPayDigits('1812345678'), null);
  assert.equal(promptPayDigits('12345'), null);
  assert.equal(promptPayDigits('08x2345678'), null);
  assert.equal(promptPayPayload('12345', 10), null);
});

test('mobile number with an amount', () => {
  const p = promptPayPayload('0812345678', 4.22);
  assert.equal(
    p.slice(0, -4),
    '000201' + '010212' + '2937' + '0016A000000677010111' + '01130066812345678' + '5303764' + '54044.22' + '5802TH' + '6304',
  );
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
});

test('ID card without an amount is a reusable QR', () => {
  const p = promptPayPayload('1234567890123');
  assert.ok(p.startsWith('000201010211' + '2937' + '0016A000000677010111' + '02131234567890123'));
  assert.ok(!p.includes('5404'));
});
