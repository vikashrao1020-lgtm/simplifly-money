import assert from 'node:assert/strict';
import test from 'node:test';
import { SyncEngine } from '../src/sync/engine.ts';

const transaction = (id, amount, updatedAt = '2026-10-01T00:00:00Z') => ({
  id,
  account_id: 'acc_4821',
  occurred_at: '2026-10-01T00:00:00Z',
  direction: 'debit',
  amount_minor: amount,
  currency: 'INR',
  merchant: id,
  category: 'FOOD',
  status: 'POSTED',
  updated_at: updatedAt,
});

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

const emptyState = (syncToken = null, records = []) => ({
  records,
  syncToken,
  lastSyncedAt: null,
  accounts: [],
  baseUrl: 'http://mock.test',
});

test('full sync deduplicates page boundaries, applies changes and coalesces refreshes', async () => {
  const requests = [];
  const commits = [];
  const first = transaction('first', 100);
  const second = transaction('second', 200);
  const fetcher = async (url) => {
    requests.push(String(url));
    await new Promise((resolve) => setTimeout(resolve, 2));
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/accounts')) return json({ items: [] });
    if (parsed.pathname.endsWith('/transactions/changes')) {
      return json({ items: [transaction('second', 400, '2026-10-02T00:00:00Z'), { id: 'first', deleted: true, updated_at: '2026-10-03T00:00:00Z' }], sync_token: 'final-token', next_cursor: null });
    }
    if (parsed.searchParams.get('cursor') === 'next') return json({ items: [first, second], next_cursor: null, sync_token: 'list-token' });
    return json({ items: [first], next_cursor: 'next', sync_token: 'list-token' });
  };
  const engine = new SyncEngine(async (state) => commits.push(state), () => {}, fetcher);
  const [left, right] = await Promise.all([engine.sync(emptyState()), engine.sync(emptyState())]);
  assert.equal(requests.length, 4);
  assert.equal(commits.length, 1);
  assert.equal(left.syncToken, 'final-token');
  assert.equal(right.records.length, 2);
  assert.equal(right.records.find((row) => row.id === 'first').deleted, true);
  assert.equal(right.records.find((row) => row.id === 'second').amountMinor, 400);
});

test('an expired change token triggers a clean full sync', async () => {
  const requests = [];
  const committed = [];
  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    requests.push(parsed.pathname);
    if (parsed.pathname.endsWith('/accounts')) return json({ items: [] });
    if (parsed.pathname.endsWith('/transactions/changes') && parsed.searchParams.get('since') === 'old-token') return json({ error: 'sync_token_expired' }, 410);
    if (parsed.pathname.endsWith('/transactions/changes')) return json({ items: [], sync_token: 'new-token', next_cursor: null });
    return json({ items: [transaction('fresh', 50)], next_cursor: null, sync_token: 'list-token' });
  };
  const engine = new SyncEngine(async (state) => committed.push(state), () => {}, fetcher);
  const result = await engine.sync(emptyState('old-token', []));
  assert.equal(requests.filter((path) => path.endsWith('/transactions')).length, 1);
  assert.equal(result.syncToken, 'new-token');
  assert.equal(result.records.length, 1);
  assert.equal(committed.length, 1);
});

test('a failed sync leaves the old snapshot untouched and does not commit', async () => {
  const existing = { id: 'saved', deleted: true, updatedAt: '2026-10-01T00:00:00Z', updatedAtMs: Date.parse('2026-10-01T00:00:00Z') };
  const current = emptyState('current-token', [existing]);
  const commits = [];
  const events = [];
  const fetcher = async (url) => new URL(String(url)).pathname.endsWith('/accounts')
    ? json({ items: [] })
    : json({ error: 'bad_request' }, 400);
  const engine = new SyncEngine(async (state) => commits.push(state), (event) => events.push(event), fetcher);
  await assert.rejects(engine.sync(current));
  assert.equal(commits.length, 0);
  assert.equal(current.records[0].id, 'saved');
  assert.equal(events.at(-1).stage, 'error');
});
