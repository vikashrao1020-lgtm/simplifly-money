import { normalizeAccounts, normalizeRecord } from '../core/normalize.ts';
import { applyVersion } from '../core/records.ts';
import type { Account, SyncState, VersionedRecord } from '../core/types.ts';
import { HttpError, getJson } from './http.ts';

type Page = {
  items?: unknown[];
  next_cursor?: string | null;
  sync_token?: string;
};

export type SyncEvent = { stage: 'syncing' | 'done' | 'error'; received: number; message?: string };
export type Commit = (state: SyncState) => Promise<void>;

const pageUrl = (baseUrl: string, path: string, params: Record<string, string | number | null>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null) query.set(key, String(value));
  return `${baseUrl.replace(/\/$/, '')}${path}?${query.toString()}`;
};

export class SyncEngine {
  private inFlight: Promise<SyncState> | null = null;
  private generation = 0;
  private controller: AbortController | null = null;
  private readonly commit: Commit;
  private readonly onEvent: (event: SyncEvent) => void;
  private readonly fetcher: typeof fetch;

  constructor(
    commit: Commit,
    onEvent: (event: SyncEvent) => void = () => {},
    fetcher: typeof fetch = fetch,
  ) {
    this.commit = commit;
    this.onEvent = onEvent;
    this.fetcher = fetcher;
  }

  invalidate(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    this.inFlight = null;
  }

  sync(current: SyncState): Promise<SyncState> {
    if (this.inFlight) return this.inFlight;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const promise = this.run(current, generation, controller.signal);
    this.inFlight = promise.finally(() => {
      if (this.inFlight === promise || this.inFlight === wrapped) this.inFlight = null;
      if (this.controller === controller) this.controller = null;
    });
    const wrapped = this.inFlight;
    return wrapped;
  }

  private async run(current: SyncState, generation: number, signal: AbortSignal): Promise<SyncState> {
    this.onEvent({ stage: 'syncing', received: 0 });
    try {
      let baseState = current;
      try {
        const accountPayload = await getJson<unknown>(`${current.baseUrl.replace(/\/$/, '')}/v1/accounts`, signal, this.fetcher);
        const accounts = normalizeAccounts(accountPayload);
        if (accounts.length) baseState = { ...current, accounts };
      } catch {
        // The cached list remains usable if accounts cannot refresh.
      }

      let committed: SyncState;
      if (!current.syncToken) {
        committed = await this.fullSync(baseState, generation, signal);
      } else {
        try {
          committed = await this.incrementalSync(baseState, generation, signal);
        } catch (error) {
          if (!(error instanceof HttpError) || error.status !== 410) throw error;
          committed = await this.fullSync(baseState, generation, signal);
        }
      }
      if (generation !== this.generation) throw new Error('Sync cancelled because the server changed');
      await this.commit(committed);
      this.onEvent({ stage: 'done', received: committed.records.length });
      return committed;
    } catch (error) {
      if (generation === this.generation) {
        this.onEvent({ stage: 'error', received: current.records.length, message: error instanceof Error ? error.message : 'Could not refresh' });
      }
      throw error;
    }
  }

  private async fullSync(current: SyncState, generation: number, signal: AbortSignal): Promise<SyncState> {
    const working = new Map<string, VersionedRecord>();
    let cursor: string | null = null;
    let token: string | null = null;
    let received = 0;
    do {
      const page: Page = await getJson<Page>(pageUrl(current.baseUrl, '/v1/transactions', { limit: 100, cursor }), signal, this.fetcher);
      if (!Array.isArray(page.items) || typeof page.sync_token !== 'string') throw new Error('The server returned an invalid transactions page');
      token ??= page.sync_token;
      for (const raw of page.items) {
        const normalized = normalizeRecord(raw);
        if (normalized) applyVersion(working, normalized);
      }
      received = working.size;
      this.onEvent({ stage: 'syncing', received });
      cursor = typeof page.next_cursor === 'string' ? page.next_cursor : null;
      if (generation !== this.generation) throw new Error('Sync cancelled because the server changed');
    } while (cursor);

    if (!token) throw new Error('The server did not provide a sync token');
    const changed = await this.applyChanges(current.baseUrl, token, working, signal, generation);
    return {
      ...current,
      records: [...working.values()],
      syncToken: changed.token,
      lastSyncedAt: new Date().toISOString(),
    };
  }

  private async incrementalSync(current: SyncState, generation: number, signal: AbortSignal): Promise<SyncState> {
    const working = new Map<string, VersionedRecord>(current.records.map((record) => [record.id, record]));
    const changed = await this.applyChanges(current.baseUrl, current.syncToken!, working, signal, generation);
    return { ...current, records: [...working.values()], syncToken: changed.token, lastSyncedAt: new Date().toISOString() };
  }

  private async applyChanges(
    baseUrl: string,
    since: string,
    working: Map<string, VersionedRecord>,
    signal: AbortSignal,
    generation: number,
  ): Promise<{ token: string }> {
    let cursor: string | null = null;
    let token: string | null = null;
    do {
      const page: Page = await getJson<Page>(pageUrl(baseUrl, '/v1/transactions/changes', { since, cursor, limit: 100 }), signal, this.fetcher);
      if (!Array.isArray(page.items)) throw new Error('The server returned an invalid changes page');
      for (const raw of page.items) {
        const normalized = normalizeRecord(raw);
        if (normalized) applyVersion(working, normalized);
      }
      if (typeof page.sync_token === 'string') token = page.sync_token;
      cursor = typeof page.next_cursor === 'string' ? page.next_cursor : null;
      if (generation !== this.generation) throw new Error('Sync cancelled because the server changed');
    } while (cursor);
    if (!token) throw new Error('The server did not provide a changes sync token');
    return { token };
  }
}
