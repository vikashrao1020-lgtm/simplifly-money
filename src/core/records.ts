import type { MonthTotals, Transaction, VersionedRecord } from './types.ts';
import { isOwnTransfer, isTombstone, isTransaction } from './types.ts';
import { monthKey } from './time.ts';

export function applyVersion(map: Map<string, VersionedRecord>, incoming: VersionedRecord): void {
  const existing = map.get(incoming.id);
  if (!existing || incoming.updatedAtMs >= existing.updatedAtMs) map.set(incoming.id, incoming);
}

export function liveTransactions(records: Iterable<VersionedRecord>): Transaction[] {
  return [...records].filter(isTransaction).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
}

export function computeMonthTotals(transactions: Iterable<Transaction>): MonthTotals[] {
  const totals = new Map<string, MonthTotals>();
  for (const transaction of transactions) {
    const month = monthKey(transaction.occurredAt);
    const entry = totals.get(month) ?? { month, spentMinor: 0, earnedMinor: 0, foreignExcludedCount: 0 };
    const inrMinor = transaction.currency === 'INR' ? transaction.amountMinor : transaction.fxInrMinor;
    if (inrMinor === null) {
      entry.foreignExcludedCount += 1;
      totals.set(month, entry);
      continue;
    }
    if (isOwnTransfer(transaction)) {
      totals.set(month, entry);
      continue;
    }
    if (transaction.direction === 'debit') {
      entry.spentMinor += inrMinor;
    } else {
      entry.earnedMinor += inrMinor;
    }
    totals.set(month, entry);
  }
  return [...totals.values()].sort((a, b) => b.month.localeCompare(a.month));
}

export function searchTransactions(
  transactions: Iterable<Transaction>,
  query: string,
  accountLabels: ReadonlyMap<string, string> = new Map(),
): Transaction[] {
  const needle = query.normalize('NFC').toLocaleLowerCase().trim();
  if (!needle) return [...transactions];
  return [...transactions].filter((transaction) =>
    [transaction.merchant, transaction.category, transaction.accountId, accountLabels.get(transaction.accountId) ?? '']
      .some((part) => part.normalize('NFC').toLocaleLowerCase().includes(needle)),
  );
}

export function visibleRecords(records: VersionedRecord[]): Transaction[] {
  return liveTransactions(records.filter((record) => !isTombstone(record)));
}
