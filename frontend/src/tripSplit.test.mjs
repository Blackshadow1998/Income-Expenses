// Run: node --test src/tripSplit.test.mjs (Node 22 strips the TypeScript types itself).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { th } from './locales/th.ts';
import { bahtText, shares, summaryText, toSatang } from './tripSplit.ts';

import { en } from './locales/en.ts';

// Same {placeholder} filling as t() in i18n.ts (the app passes t() itself).
const translator = (dict) => (key, params = {}) => dict[key].replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
const tTh = translator(th);
const tEn = translator(en);

const A = 1, B = 2, C = 3, D = 4, E = 5;
const parts = (...ms) => ms.map((member) => ({ member, value: 0 }));

test('equal split: leftover satang go to the payer', () => {
  assert.deepEqual(shares(100000, B, 'equal', parts(A, B, D)), { shares: [33333, 33334, 33333] });
  assert.deepEqual(shares(40000, A, 'equal', parts(A, D, E)), { shares: [13334, 13333, 13333] });
});

test('equal split: payer not sharing, leftover to the first listed', () => {
  assert.deepEqual(shares(1000, E, 'equal', parts(B, C, D)), { shares: [334, 333, 333] });
});

test('split by amount must add up to the bill', () => {
  assert.deepEqual(shares(10000, A, 'amount', [{ member: A, value: 4000 }, { member: B, value: 6000 }]), { shares: [4000, 6000] });
  const r = shares(10000, A, 'amount', [{ member: A, value: 3000 }, { member: B, value: 6000 }]);
  assert.deepEqual(r.error, { key: 'split.mismatch', params: { sum: '90.00', amount: '100.00' } });
  assert.match(tTh(r.error.key, r.error.params), /90\.00 ไม่เท่ากับยอดบิล 100\.00/);
});

test('split by ratio', () => {
  assert.deepEqual(shares(100000, A, 'ratio', [{ member: A, value: 2 }, { member: B, value: 1 }, { member: C, value: 1 }]), {
    shares: [50000, 25000, 25000],
  });
  assert.equal(shares(1000, A, 'ratio', [{ member: A, value: 1.5 }]).error.key, 'split.badRatio');
});

test('rejects empty bills', () => {
  assert.equal(shares(0, A, 'equal', parts(A)).error.key, 'split.amountPositive');
  assert.equal(shares(1000, A, 'equal', []).error.key, 'split.noMembers');
  assert.equal(shares(1000, A, 'amount', [{ member: A, value: -1 }]).error.key, 'split.negative');
});

test('every split error has a Thai text', () => {
  for (const key of ['split.amountPositive', 'split.noMembers', 'split.negative', 'split.mismatch', 'split.badRatio']) assert.ok(th[key], key);
});

test('money text', () => {
  assert.equal(bahtText(20833), '208.33');
  assert.equal(bahtText(-59166), '-591.66');
  assert.equal(bahtText(123456789), '1,234,567.89');
  assert.equal(toSatang('1,000.5'), 100050);
  assert.ok(Number.isNaN(toSatang('abc')));
});

const SUMMARY = {
  mode: 'pairwise',
  total: 1900,
  pairs: [
    { from_name: 'A', to_name: 'B', remaining: 208.33, status: 'unpaid' },
    { from_name: 'C', to_name: 'A', remaining: 0, status: 'paid' },
  ],
  transfers: [],
  people: [{ name: 'A', net: 308.33 }, { name: 'C', net: 0 }],
};

test('copyable summary lists what is still due', () => {
  const text = summaryText('เชียงใหม่', SUMMARY, tTh);
  assert.match(text, /สรุปค่าใช้จ่ายทริป "เชียงใหม่"/);
  assert.match(text, /• A โอนให้ B 208\.33 บาท/);
  assert.match(text, /✓ C → A จ่ายครบแล้ว/);
  assert.doesNotMatch(text, /C โอนให้ A/);
  assert.match(text, /A \+308\.33/);
});

test('copyable summary in English', () => {
  const text = summaryText('Chiang Mai', SUMMARY, tEn);
  assert.match(text, /Trip expenses: "Chiang Mai"/);
  assert.match(text, /Total 1,900\.00 baht/);
  assert.match(text, /• A pays B 208\.33 baht/);
  assert.match(text, /✓ C → A paid in full/);
  assert.match(text, /A \+308\.33/);
  assert.doesNotMatch(text, /[\u0E00-\u0E7F]/);
});
