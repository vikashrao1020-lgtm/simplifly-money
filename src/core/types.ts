export type Direction = 'debit' | 'credit';

export type Account = {
  id: string;
  bank: string;
  type: string;
  last4: string;
  nickname: string;
};

export type Transaction = {
  id: string;
  accountId: string;
  occurredAt: string;
  direction: Direction;
  amountMinor: number;
  currency: string;
  merchant: string;
  category: string;
  status: string;
  updatedAt: string | null;
  updatedAtMs: number;
  counterparty: { type?: string; accountId?: string } | null;
  linkedAccount: string | null;
  fxInrMinor: number | null;
  sourceSchema: 'legacy' | 'v2';
  raw: Record<string, unknown>;
};

export type Tombstone = {
  id: string;
  deleted: true;
  updatedAt: string | null;
  updatedAtMs: number;
};

export type VersionedRecord = Transaction | Tombstone;

export type MonthTotals = {
  month: string;
  spentMinor: number;
  earnedMinor: number;
  foreignExcludedCount: number;
};

export type SyncState = {
  records: VersionedRecord[];
  syncToken: string | null;
  lastSyncedAt: string | null;
  accounts: Account[];
  baseUrl: string;
};

export const isTombstone = (record: VersionedRecord): record is Tombstone =>
  'deleted' in record && record.deleted;

export const isTransaction = (record: VersionedRecord): record is Transaction =>
  !isTombstone(record);

export const isOwnTransfer = (transaction: Transaction): boolean =>
  transaction.counterparty?.type === 'OWN_ACCOUNT' ||
  Boolean(transaction.linkedAccount) ||
  transaction.category.toUpperCase() === 'TRANSFER';
