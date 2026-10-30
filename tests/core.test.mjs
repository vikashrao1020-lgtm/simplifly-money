import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parseRupeesToMinor, formatINR } from '../src/core/money.ts';
import { normalizeRecord, normalizeTransaction } from '../src/core/normalize.ts';
import { applyVersion, computeMonthTotals, liveTransactions, searchTransactions } from '../src/core/records.ts';
import { monthKey } from '../src/core/time.ts';

test('money stays in paise and formats in Indian grouping', () => {
  assert.equal(parseRupeesToMinor('516.49'), 51649);
  assert.equal(parseRupeesToMinor('0.5'), 50);
  assert.equal(parseRupeesToMinor('1,234.567'), 123457);
  assert.equal(parseRupeesToMinor('not money'), null);
  assert.equal(formatINR(123456789), '₹12,34,567.89');
  assert.equal(formatINR(5), '₹0.05');
  assert.equal(formatINR(100000), '₹1,000.00');
});

test('legacy and v2 rows normalize to one transaction shape', () => {
  const legacy = normalizeTransaction({
    id: '104535', account: '4821', txn_time: 1774981380, amount: '516.49', type: 'DR',
    merchant_name: 'Coffee Shop', category: 'FOOD', linked_account: '3310', status: 'POSTED',
  });
  assert.ok(legacy);
  assert.equal(legacy.amountMinor, 51649);
  assert.equal(legacy.accountId, 'acc_4821');
  assert.equal(legacy.sourceSchema, 'legacy');
  assert.equal(legacy.currency, 'INR');
  assert.equal(legacy.direction, 'debit');
  assert.equal(legacy.linkedAccount, '3310');
  assert.equal(normalizeRecord({ id: 'gone', deleted: true, updated_at: '2026-10-01T00:00:00Z' })?.id, 'gone');
  assert.equal(normalizeTransaction({ id: 'bad', occurred_at: 'not a date' }), null);
});

test('version resolution keeps the newest row and tombstone', () => {
  const map = new Map();
  const newer = normalizeTransaction({ id: 'same', account_id: 'acc_4821', occurred_at: '2026-10-01T00:00:00Z', direction: 'debit', amount_minor: 200, merchant: 'New', updated_at: '2026-10-02T00:00:00Z' });
  const older = normalizeTransaction({ id: 'same', account_id: 'acc_4821', occurred_at: '2026-10-01T00:00:00Z', direction: 'debit', amount_minor: 100, merchant: 'Old', updated_at: '2026-10-01T00:00:00Z' });
  assert.ok(newer && older);
  applyVersion(map, newer);
  applyVersion(map, older);
  assert.equal(liveTransactions(map.values())[0].merchant, 'New');
  applyVersion(map, { id: 'same', deleted: true, updatedAt: '2026-10-03T00:00:00Z', updatedAtMs: Date.parse('2026-10-03T00:00:00Z') });
  applyVersion(map, newer);
  assert.equal(liveTransactions(map.values()).length, 0);
});

test('months are bucketed in IST and merchant search preserves Devanagari', () => {
  assert.equal(monthKey('2026-09-30T19:15:00Z'), '2026-10');
  assert.equal(monthKey('2026-09-30T18:29:59Z'), '2026-09');
  const rows = [
    normalizeTransaction({ id: 'hindi', account_id: 'acc_4821', occurred_at: '2026-10-01T00:00:00Z', direction: 'debit', amount_minor: 100, merchant: 'राम किराना स्टोर' }),
    normalizeTransaction({ id: 'chai', account_id: 'acc_4821', occurred_at: '2026-10-01T00:00:00Z', direction: 'debit', amount_minor: 100, merchant: 'UPI/CHAI POINT' }),
  ].filter(Boolean);
  assert.equal(searchTransactions(rows, 'किराना').length, 1);
  assert.equal(searchTransactions(rows, 'chai').length, 1);
});

test('replays the mock fixture changes to the provided checkpoint', { skip: fixturePath() ? false : 'Set FIXTURES_DIR to run the repository reconciliation check.' }, () => {
  const dir = fixturePath();
  const list = JSON.parse(readFileSync(resolve(dir, 'transactions.json'), 'utf8'));
  const changes = JSON.parse(readFileSync(resolve(dir, 'changes.json'), 'utf8'));
  const checkpoint = JSON.parse(readFileSync(resolve(dir, 'checkpoint.json'), 'utf8'));
  const map = new Map();
  for (const row of [...list, ...changes]) {
    const normalized = normalizeRecord(row);
    if (normalized) applyVersion(map, normalized);
  }
  const transactions = liveTransactions(map.values());
  assert.equal(transactions.length, checkpoint.transaction_count);
  const totals = new Map(computeMonthTotals(transactions).map((item) => [item.month, item]));
  assert.deepEqual([...totals.keys()].sort(), Object.keys(checkpoint.months).sort());
  for (const [month, expected] of Object.entries(checkpoint.months)) {
    assert.equal(totals.get(month).spentMinor, parseRupeesToMinor(expected.spend), `${month} spend`);
    assert.equal(totals.get(month).earnedMinor, parseRupeesToMinor(expected.income), `${month} income`);
  }
});

function fixturePath() {
  const candidates = [
    process.env.FIXTURES_DIR,
    process.env.TRACK_API_DIR ? resolve(process.env.TRACK_API_DIR, 'fixtures') : null,
    resolve(process.cwd(), '..', 'work', 'track-api-mock', 'fixtures'),
    resolve(process.cwd(), '..', 'track-api-mock', 'fixtures'),
  ].filter(Boolean);
  return candidates.find((path) => existsSync(resolve(path, 'checkpoint.json'))) ?? null;
}
