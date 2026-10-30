import { parseRupeesToMinor } from './money.ts';
import type { Account, Tombstone, Transaction, VersionedRecord } from './types';

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const stringValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const numberValue = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const normalizeAccountId = (value: unknown): string => {
  const raw = stringValue(value) ?? 'unknown';
  return raw.startsWith('acc_') || raw === 'unknown' ? raw : `acc_${raw}`;
};

const categoryLabel = (value: unknown): string => {
  const category = stringValue(value)?.toUpperCase();
  if (!category) return 'UNCATEGORISED';
  if (category === 'DINING_OUT') return 'FOOD';
  return category;
};

export function normalizeTransaction(value: unknown): Transaction | null {
  const raw = object(value);
  if (!raw) return null;
  const id = stringValue(raw.id);
  const legacy = !stringValue(raw.occurred_at);
  const epoch = numberValue(raw.txn_time);
  const occurredAt = stringValue(raw.occurred_at) ??
    (epoch !== null ? new Date(epoch * 1000).toISOString() : null);
  const direction = raw.direction === 'debit' || raw.direction === 'credit'
    ? raw.direction
    : raw.type === 'DR' ? 'debit' : raw.type === 'CR' ? 'credit' : null;
  const amountMinor = numberValue(raw.amount_minor) ??
    (typeof raw.amount === 'string' || typeof raw.amount === 'number'
      ? parseRupeesToMinor(raw.amount)
      : null);
  const merchant = stringValue(raw.merchant) ?? stringValue(raw.merchant_name);
  if (!id || !occurredAt || !Number.isFinite(Date.parse(occurredAt)) || !direction || amountMinor === null || !merchant) {
    return null;
  }

  const counterpartyRaw = object(raw.counterparty);
  const updatedAt = stringValue(raw.updated_at);
  const fxRaw = object(raw.fx);
  const fxInrMinor = numberValue(fxRaw?.inr_minor);
  const transaction: Transaction = {
    id,
    accountId: normalizeAccountId(raw.account_id ?? raw.account),
    occurredAt,
    direction,
    amountMinor: Math.round(amountMinor),
    currency: stringValue(raw.currency)?.toUpperCase() ?? 'INR',
    merchant,
    category: categoryLabel(raw.category),
    status: stringValue(raw.status)?.toUpperCase() ?? 'UNKNOWN',
    updatedAt,
    updatedAtMs: updatedAt ? Date.parse(updatedAt) : 0,
    counterparty: counterpartyRaw
      ? {
          type: stringValue(counterpartyRaw.type) ?? undefined,
          accountId: stringValue(counterpartyRaw.account_id) ?? undefined,
        }
      : null,
    linkedAccount: stringValue(raw.linked_account),
    fxInrMinor: fxInrMinor === null ? null : Math.round(fxInrMinor),
    sourceSchema: legacy ? 'legacy' : 'v2',
    raw,
  };
  return transaction;
}

export function normalizeTombstone(value: unknown): Tombstone | null {
  const raw = object(value);
  if (!raw || raw.deleted !== true) return null;
  const id = stringValue(raw.id);
  if (!id) return null;
  const updatedAt = stringValue(raw.updated_at);
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : 0;
  return { id, deleted: true, updatedAt, updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0 };
}

export function normalizeRecord(value: unknown): VersionedRecord | null {
  return normalizeTombstone(value) ?? normalizeTransaction(value);
}

export function normalizeAccounts(value: unknown): Account[] {
  const root = object(value);
  if (!Array.isArray(root?.items)) return [];
  return root.items.flatMap((item) => {
    const row = object(item);
    if (!row) return [];
    const id = stringValue(row.id);
    if (!id) return [];
    return [{
      id,
      bank: stringValue(row.bank) ?? 'Bank account',
      type: stringValue(row.type) ?? 'UNKNOWN',
      last4: stringValue(row.last4) ?? id.slice(-4),
      nickname: stringValue(row.nickname) ?? stringValue(row.bank) ?? 'Account',
    }];
  });
}
