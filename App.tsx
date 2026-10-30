import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { computeMonthTotals, liveTransactions, searchTransactions } from './src/core/records.ts';
import { formatForeign, formatINR } from './src/core/money.ts';
import { dateTimeIST, monthKey, monthLabel, relativeSyncedAt, timeOnlyIST } from './src/core/time.ts';
import { isOwnTransfer, type Account, type MonthTotals, type SyncState, type Transaction } from './src/core/types.ts';
import { loadState, commitState } from './src/store/database.ts';
import { SyncEngine, type SyncEvent } from './src/sync/engine.ts';
import { colors } from './src/theme.ts';

const FALLBACK_API = process.env.EXPO_PUBLIC_API_BASE_URL ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:4010' : 'http://localhost:4010');
const INITIAL_STATE: SyncState = { records: [], syncToken: null, lastSyncedAt: null, accounts: [], baseUrl: FALLBACK_API };

type Filter = 'all' | 'spent' | 'earned' | 'transfer';
type MonthSection = { month: string; title: string; totals: MonthTotals; data: Transaction[]; inResults: boolean };

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All', spent: 'Spending', earned: 'Income', transfer: 'Transfers',
};

function categoryTitle(category: string): string {
  if (category === 'UNCATEGORISED') return 'Uncategorised';
  return category.toLowerCase().split('_').map((word) => word ? word[0].toUpperCase() + word.slice(1) : '').join(' ');
}

function accountName(accountId: string, accounts: Account[]): string {
  const account = accounts.find((entry) => entry.id === accountId);
  if (!account) return accountId === 'unknown' ? 'Account unavailable' : `Account ··${accountId.slice(-4)}`;
  return `${account.nickname} ··${account.last4}`;
}

function amountForRow(transaction: Transaction): { primary: string; secondary: string | null } {
  const prefix = transaction.direction === 'debit' ? '−' : '+';
  if (transaction.currency === 'INR') return { primary: `${prefix}${formatINR(transaction.amountMinor)}`, secondary: null };
  const secondary = transaction.fxInrMinor === null ? null : `≈ ${formatINR(transaction.fxInrMinor)}`;
  return { primary: `${prefix}${formatForeign(transaction.amountMinor, transaction.currency)}`, secondary };
}

const TransactionRow = memo(function TransactionRow({
  transaction,
  accounts,
  onPress,
}: {
  transaction: Transaction;
  accounts: Account[];
  onPress: (transaction: Transaction) => void;
}) {
  const transfer = isOwnTransfer(transaction);
  const amount = amountForRow(transaction);
  const earned = transaction.direction === 'credit' && !transfer;
  const iconName = transfer ? 'swap-horizontal-outline' : earned ? 'arrow-down-circle-outline' :
    transaction.category === 'FOOD' ? 'restaurant-outline' :
    transaction.category === 'TRANSPORT' ? 'car-outline' :
    transaction.category === 'GROCERIES' ? 'basket-outline' : 'receipt-outline';
  const accessibleKind = transfer ? 'transfer between your accounts, not included in totals' : earned ? 'earned' : 'spent';
  const label = `${transaction.merchant}, ${accessibleKind}, ${amount.primary}, ${dateTimeIST(transaction.occurredAt)}, ${transaction.status.toLowerCase()}, ${accountName(transaction.accountId, accounts)}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens transaction details"
      onPress={() => onPress(transaction)}
      style={({ pressed }) => [styles.transactionRow, pressed && styles.rowPressed]}
    >
      <View style={[styles.merchantIcon, transfer && styles.transferIcon, earned && styles.incomeIcon]}>
        <Ionicons name={iconName} size={20} color={transfer ? colors.muted : earned ? colors.green : colors.navy} />
      </View>
      <View style={styles.transactionInfo}>
        <View style={styles.merchantLine}>
          <Text style={styles.merchant} numberOfLines={1}>{transaction.merchant}</Text>
          {transaction.status === 'PENDING' && <Text style={styles.pendingChip}>Pending</Text>}
        </View>
        <Text style={styles.transactionMeta} numberOfLines={1}>
          {transfer ? 'Transfer between your accounts' : categoryTitle(transaction.category)} · {accountName(transaction.accountId, accounts)}
        </Text>
        {transfer && <Text style={styles.transferNote}>Not counted in spent or earned</Text>}
        {amount.secondary && <Text style={styles.fxEquivalent}>{amount.secondary} INR equivalent</Text>}
      </View>
      <View style={styles.amountColumn}>
        <Text style={[styles.transactionAmount, transfer && styles.mutedAmount, earned && styles.earnedAmount]} numberOfLines={1} adjustsFontSizeToFit>
          {amount.primary}
        </Text>
        <Text style={styles.transactionTime}>{timeOnlyIST(transaction.occurredAt)}</Text>
      </View>
    </Pressable>
  );
});

function MonthHeader({ section, currentMonth }: { section: MonthSection; currentMonth: string }) {
  const current = section.month === currentMonth;
  return (
    <View accessibilityRole="header" style={styles.monthHeader}>
      <View style={styles.monthHeadingLine}>
        <Text style={styles.monthTitle}>{section.title}</Text>
        {current && <Text style={styles.soFarPill}>SO FAR</Text>}
        {section.inResults && <Text style={styles.resultsPill}>IN RESULTS</Text>}
      </View>
      <View style={styles.monthTotalsRow}>
        <Text style={styles.spentSummary}>Spent <Text style={styles.monthTotalValue}>{formatINR(section.totals.spentMinor)}</Text></Text>
        <Text style={styles.earnedSummary}>Earned <Text style={styles.monthTotalValue}>{formatINR(section.totals.earnedMinor)}</Text></Text>
        <Text style={styles.countSummary}>{section.data.length}</Text>
      </View>
      {section.totals.foreignExcludedCount > 0 && (
        <Text style={styles.fxFootnote}>+{section.totals.foreignExcludedCount} transaction(s) in other currency not included</Text>
      )}
    </View>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<SyncState>(INITIAL_STATE);
  const snapshotRef = useRef(snapshot);
  const [syncEvent, setSyncEvent] = useState<SyncEvent>({ stage: 'syncing', received: 0 });
  const [isReady, setIsReady] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverDraft, setServerDraft] = useState(FALLBACK_API);
  const [savingServer, setSavingServer] = useState(false);
  const engine = useRef<SyncEngine | null>(null);

  if (!engine.current) {
    engine.current = new SyncEngine(async (next) => {
      await commitState(next);
      snapshotRef.current = next;
      setSnapshot(next);
    }, setSyncEvent);
  }

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(timeout);
  }, [query]);

  const syncNow = useCallback(async () => {
    try {
      await engine.current?.sync(snapshotRef.current);
    } catch {
      // The last committed SQLite snapshot stays visible and the banner owns the retry action.
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const saved = await loadState(FALLBACK_API);
      if (!active) return;
      snapshotRef.current = saved;
      setSnapshot(saved);
      setServerDraft(saved.baseUrl);
      setIsReady(true);
      void syncNow();
    })().catch(() => {
      if (!active) return;
      setIsReady(true);
      setSyncEvent({ stage: 'error', received: 0, message: 'Could not open the saved transaction history.' });
    });
    return () => { active = false; };
  }, [syncNow]);

  const transactions = useMemo(() => liveTransactions(snapshot.records), [snapshot.records]);
  const filtered = useMemo(() => {
    const accountLabels = new Map(snapshot.accounts.map((account) => [account.id, `${account.nickname} ${account.bank} ${account.last4}`]));
    const searchResults = searchTransactions(transactions, debouncedQuery, accountLabels);
    if (filter === 'all') return searchResults;
    if (filter === 'spent') return searchResults.filter((transaction) => transaction.direction === 'debit' && !isOwnTransfer(transaction));
    if (filter === 'earned') return searchResults.filter((transaction) => transaction.direction === 'credit' && !isOwnTransfer(transaction));
    return searchResults.filter(isOwnTransfer);
  }, [transactions, debouncedQuery, filter, snapshot.accounts]);

  const monthTotals = useMemo(() => computeMonthTotals(filtered), [filtered]);
  const allMonthTotals = useMemo(() => computeMonthTotals(transactions), [transactions]);
  const sections = useMemo<MonthSection[]>(() => {
    const byMonth = new Map<string, Transaction[]>();
    for (const transaction of filtered) {
      const key = monthKey(transaction.occurredAt);
      const rows = byMonth.get(key) ?? [];
      rows.push(transaction);
      byMonth.set(key, rows);
    }
    const totalsByMonth = new Map(monthTotals.map((entry) => [entry.month, entry]));
    return [...byMonth.entries()].map(([month, rows]) => ({
      month,
      title: monthLabel(month),
      data: rows,
      totals: totalsByMonth.get(month) ?? { month, spentMinor: 0, earnedMinor: 0, foreignExcludedCount: 0 },
      inResults: Boolean(debouncedQuery || filter !== 'all'),
    }));
  }, [filtered, monthTotals, debouncedQuery, filter]);

  const currentMonth = monthKey(new Date().toISOString());
  const currentTotal = allMonthTotals.find((item) => item.month === currentMonth) ?? {
    month: currentMonth, spentMinor: 0, earnedMinor: 0, foreignExcludedCount: 0,
  };
  const firstSync = syncEvent.stage === 'syncing' && !snapshot.lastSyncedAt;
  const countLabel = `${filtered.length.toLocaleString('en-IN')} ${filtered.length === 1 ? 'transaction' : 'transactions'}`;

  const changeFilter = () => {
    const filters: Filter[] = ['all', 'spent', 'earned', 'transfer'];
    setFilter(filters[(filters.indexOf(filter) + 1) % filters.length]);
  };

  const saveServer = async () => {
    const baseUrl = serverDraft.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(baseUrl)) return;
    setSavingServer(true);
    engine.current?.invalidate();
    const cleared: SyncState = { records: [], syncToken: null, lastSyncedAt: null, accounts: [], baseUrl };
    try {
      await commitState(cleared);
      snapshotRef.current = cleared;
      setSnapshot(cleared);
      setSettingsOpen(false);
      setSyncEvent({ stage: 'syncing', received: 0 });
      await syncNow();
    } finally {
      setSavingServer(false);
    }
  };

  const renderItem = useCallback(({ item }: { item: Transaction }) => (
    <TransactionRow transaction={item} accounts={snapshot.accounts} onPress={(transaction) => { setTechnicalOpen(false); setSelected(transaction); }} />
  ), [snapshot.accounts]);

  const renderSectionHeader = useCallback(({ section }: { section: MonthSection }) => (
    <MonthHeader section={section} currentMonth={currentMonth} />
  ), [currentMonth]);

  const refreshControl = useMemo(() => (
    <RefreshControl
      refreshing={syncEvent.stage === 'syncing' && Boolean(snapshot.lastSyncedAt)}
      onRefresh={() => { void syncNow(); }}
      tintColor={colors.goldDeep}
      colors={[colors.goldDeep]}
      progressBackgroundColor={colors.surface}
      accessibilityLabel="Refresh transaction history"
    />
  ), [syncEvent.stage, snapshot.lastSyncedAt, syncNow]);

  const account = selected ? accountName(selected.accountId, snapshot.accounts) : '';
  const ownTransfer = selected ? isOwnTransfer(selected) : false;
  const selectedAmount = selected ? amountForRow(selected) : null;
  const selectedDeleted = Boolean(selected && !transactions.some((transaction) => transaction.id === selected.id));

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <View style={styles.appBody}>
      <View style={styles.brandBar}>
        <Image source={require('./assets/SM_Logo_White_Gold.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Simplify Money" />
        <Pressable accessibilityRole="button" accessibilityLabel="Server settings" onPress={() => { setServerDraft(snapshot.baseUrl); setSettingsOpen(true); }} style={styles.settingsButton}>
          <Ionicons name="settings-outline" size={20} color={colors.white} />
        </Pressable>
      </View>

      <View style={styles.screenIntro}>
        <View>
          <Text style={styles.screenTitle}>Track</Text>
          <Text style={styles.screenSubtitle}>Everyday money, made clearer.</Text>
        </View>
        <View style={styles.syncStatus}>
          <View style={[styles.syncDot, syncEvent.stage === 'error' && styles.syncDotError]} />
          <Text style={styles.syncStatusText} numberOfLines={1}>
            {syncEvent.stage === 'syncing' ? firstSync ? 'Syncing history' : 'Refreshing' : relativeSyncedAt(snapshot.lastSyncedAt)}
          </Text>
        </View>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryTitleRow}>
          <View>
            <Text style={styles.summaryEyebrow}>{monthLabel(currentMonth).toUpperCase()} · SO FAR</Text>
            <Text style={styles.summaryTitle}>Your money this month</Text>
          </View>
          <View style={styles.summaryMark}><Ionicons name="sparkles-outline" size={17} color={colors.gold} /></View>
        </View>
        <View style={styles.summaryMetrics}>
          <View style={styles.summaryMetric}>
            <View style={styles.metricLabelRow}><View style={styles.spentDot} /><Text style={styles.summaryMetricLabel}>Spent</Text></View>
            <Text style={styles.summaryMetricValue} adjustsFontSizeToFit numberOfLines={1}>{firstSync ? 'Syncing…' : formatINR(currentTotal.spentMinor)}</Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.summaryMetric}>
            <View style={styles.metricLabelRow}><View style={styles.earnedDot} /><Text style={styles.summaryMetricLabel}>Earned</Text></View>
            <Text style={styles.summaryMetricValue} adjustsFontSizeToFit numberOfLines={1}>{firstSync ? 'Syncing…' : formatINR(currentTotal.earnedMinor)}</Text>
          </View>
        </View>
        <Text style={styles.summaryFootnote}>
          {firstSync ? `${syncEvent.received.toLocaleString('en-IN')} transactions found so far · totals appear when sync finishes` : `${transactions.length.toLocaleString('en-IN')} transactions across your connected accounts`}
        </Text>
      </View>

      <View style={styles.searchAndFilter}>
        <View style={styles.searchField}>
          <Ionicons name="search-outline" size={19} color={colors.muted} />
          <TextInput
            accessibilityLabel="Search transactions"
            value={query}
            onChangeText={setQuery}
            placeholder="Search merchants or categories"
            placeholderTextColor="#77848D"
            returnKeyType="search"
            autoCorrect={false}
            style={styles.searchInput}
          />
          {query.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} hitSlop={8}><Ionicons name="close-circle" size={19} color={colors.muted} /></Pressable>}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Filter transactions, currently ${FILTER_LABELS[filter]}`}
          accessibilityState={{ selected: filter !== 'all' }}
          onPress={changeFilter}
          style={[styles.filterButton, filter !== 'all' && styles.filterActive]}
        >
          <Ionicons name="options-outline" size={17} color={filter !== 'all' ? colors.navy : colors.body} />
          <Text style={[styles.filterLabel, filter !== 'all' && styles.filterLabelActive]}>{FILTER_LABELS[filter]}</Text>
        </Pressable>
      </View>

      {(syncEvent.stage === 'error' || (syncEvent.stage === 'syncing' && Boolean(snapshot.lastSyncedAt))) && (
        <View style={[styles.syncBanner, syncEvent.stage === 'error' && styles.errorBanner]} accessibilityRole="alert">
          <Ionicons name={syncEvent.stage === 'error' ? 'cloud-offline-outline' : 'sync-outline'} size={18} color={syncEvent.stage === 'error' ? colors.red : colors.navy} />
          <Text style={styles.syncBannerText}>
            {syncEvent.stage === 'error' ? `Couldn't refresh · showing saved data${snapshot.lastSyncedAt ? ` from ${dateTimeIST(snapshot.lastSyncedAt)}` : ''}` : 'Refreshing your saved transaction history…'}
          </Text>
          {syncEvent.stage === 'error' && <Pressable onPress={() => { void syncNow(); }} accessibilityRole="button" accessibilityLabel="Retry sync" hitSlop={10}><Text style={styles.retryText}>Retry</Text></Pressable>}
        </View>
      )}

      <View style={styles.listLabelRow}>
        <Text style={styles.listLabel}>{debouncedQuery ? 'Search results' : filter === 'all' ? 'Transactions' : FILTER_LABELS[filter]}</Text>
        <Text style={styles.resultCount}>{countLabel}</Text>
      </View>

      {sections.length > 0 ? (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled
          initialNumToRender={14}
          maxToRenderPerBatch={16}
          windowSize={9}
          updateCellsBatchingPeriod={45}
          removeClippedSubviews={Platform.OS === 'android'}
          refreshControl={refreshControl}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={currentTotal.foreignExcludedCount > 0 && !debouncedQuery ? (
            <Text style={styles.listFootnote}>Some foreign currency transactions are excluded where an INR equivalent was not supplied.</Text>
          ) : <View style={{ height: 16 }} />}
        />
      ) : !isReady || firstSync ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={colors.goldDeep} />
          <Text style={styles.emptyTitle}>{isReady ? 'Finding your transactions' : 'Opening your history'}</Text>
          <Text style={styles.emptyBody}>{isReady ? `${syncEvent.received.toLocaleString('en-IN')} records scanned so far. Month totals appear after the first complete sync.` : 'Your saved transactions will appear here.'}</Text>
        </View>
      ) : (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}><Ionicons name={transactions.length ? 'search-outline' : 'cloud-offline-outline'} size={26} color={colors.blue} /></View>
          <Text style={styles.emptyTitle}>{transactions.length ? 'No matching transactions' : syncEvent.stage === 'syncing' ? 'Finding your transactions' : 'No transactions yet'}</Text>
          <Text style={styles.emptyBody}>
            {transactions.length ? 'Try a different merchant or clear your filters.' : syncEvent.stage === 'error' ? 'We couldn’t reach the server. Your saved history will appear here when available.' : 'Your transaction history will appear here after the first sync.'}
          </Text>
          {syncEvent.stage === 'error' && transactions.length === 0 && <Pressable style={styles.emptyRetry} onPress={() => { void syncNow(); }} accessibilityRole="button"><Text style={styles.emptyRetryText}>Try again</Text></Pressable>}
        </View>
      )}

      <Modal visible={Boolean(selected)} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close transaction details" style={styles.modalScrim} onPress={() => setSelected(null)} />
          {selectedDeleted ? (
            <View style={styles.detailSheet}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetTitleRow}>
                <Text style={styles.sheetEyebrow}>TRANSACTION DETAILS</Text>
                <Pressable onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel="Close details" style={styles.closeButton}><Ionicons name="close" size={20} color={colors.body} /></Pressable>
              </View>
              <Text style={styles.detailMerchant}>This transaction no longer exists</Text>
              <Text style={styles.detailCategory}>It was removed during the latest sync.</Text>
            </View>
          ) : selected && selectedAmount && (
            <View style={styles.detailSheet}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetTitleRow}>
                <Text style={styles.sheetEyebrow}>TRANSACTION DETAILS</Text>
                <Pressable onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel="Close details" style={styles.closeButton}><Ionicons name="close" size={20} color={colors.body} /></Pressable>
              </View>
              <Text style={styles.detailMerchant}>{selected.merchant}</Text>
              <Text style={styles.detailCategory}>{categoryTitle(selected.category)} · {selected.status}</Text>
              <Text style={[styles.detailAmount, selected.direction === 'credit' && !ownTransfer && styles.earnedAmount]}>{selectedAmount.primary}</Text>
              {selectedAmount.secondary && <Text style={styles.detailFx}>{selectedAmount.secondary} INR equivalent · conversion supplied by the server</Text>}
              {selected.status === 'PENDING' && <Text style={styles.detailNote}>This amount is provisional and may change when the transaction is fully posted.</Text>}
              {ownTransfer && <Text style={styles.detailNote}>This is a transfer between your own accounts. It appears in your history but is not counted as spent or earned.</Text>}
              <View style={styles.detailRows}>
                <DetailRow label="Direction" value={selected.direction === 'debit' ? 'Debit · Spent' : ownTransfer ? 'Credit · Transfer' : 'Credit · Earned'} />
                <DetailRow label="Status" value={selected.status} />
                <DetailRow label="Category" value={categoryTitle(selected.category)} />
                <DetailRow label="Account" value={account} />
                {selected.counterparty && <DetailRow label="Counterparty" value={selected.counterparty.accountId ? accountName(selected.counterparty.accountId, snapshot.accounts) : selected.counterparty.type ?? 'Account transfer'} />}
                {selected.linkedAccount && <DetailRow label="Counterparty" value={accountName(selected.linkedAccount.startsWith('acc_') ? selected.linkedAccount : `acc_${selected.linkedAccount}`, snapshot.accounts)} />}
                <DetailRow label="Date and time" value={`${dateTimeIST(selected.occurredAt)} IST`} />
                {selected.updatedAt && <DetailRow label="Last updated" value={dateTimeIST(selected.updatedAt)} />}
                <DetailRow label="Transaction ID" value={selected.id} />
              </View>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: technicalOpen }} onPress={() => setTechnicalOpen((open) => !open)} style={styles.technicalToggle}>
                <Text style={styles.technicalToggleText}>Technical details</Text><Ionicons name={technicalOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.blue} />
              </Pressable>
              {technicalOpen && <View style={styles.technicalBox}><Text style={styles.technicalLabel}>Source schema · {selected.sourceSchema}</Text><Text selectable style={styles.technicalRaw}>{JSON.stringify({ ...selected.raw, occurred_at_utc: selected.occurredAt, updated_at: selected.updatedAt }, null, 2)}</Text></View>}
            </View>
          )}
        </View>
      </Modal>

      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <KeyboardAvoidingView style={styles.settingsRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close server settings" style={styles.modalScrim} onPress={() => setSettingsOpen(false)} />
          <View style={styles.settingsCard}>
            <View style={styles.sheetTitleRow}><Text style={styles.sheetEyebrow}>CONNECTION</Text><Pressable onPress={() => setSettingsOpen(false)} accessibilityRole="button" accessibilityLabel="Close settings" style={styles.closeButton}><Ionicons name="close" size={20} color={colors.body} /></Pressable></View>
            <Text style={styles.settingsTitle}>Transaction server</Text>
            <Text style={styles.settingsDescription}>Set the mock API address. Changing it clears this device’s saved history and starts a fresh sync.</Text>
            <Text style={styles.inputLabel}>Server URL</Text>
            <TextInput value={serverDraft} onChangeText={setServerDraft} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Transaction server URL" style={styles.serverInput} placeholder="http://10.0.2.2:4010" placeholderTextColor={colors.muted} />
            <Text style={styles.settingsHint}>{Platform.OS === 'android' ? 'Android emulator: http://10.0.2.2:4010 · phone: use your computer’s LAN IP' : 'Simulator: http://localhost:4010 · phone: use your computer’s LAN IP'}</Text>
            <Pressable accessibilityRole="button" disabled={savingServer || !serverDraft.trim()} onPress={() => { void saveServer(); }} style={[styles.saveButton, (savingServer || !serverDraft.trim()) && styles.saveButtonDisabled]}>
              {savingServer ? <ActivityIndicator color={colors.navy} /> : <Text style={styles.saveButtonText}>Save and sync</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      </View>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue} selectable>{value}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.navy,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0,
    paddingBottom: Platform.OS === 'android' ? 24 : 0,
  },
  appBody: { flex: 1, backgroundColor: colors.background },
  brandBar: { height: 58, backgroundColor: colors.navy, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { width: 144, height: 34 },
  settingsButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  screenIntro: { paddingTop: 17, paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 },
  screenTitle: { color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.8 },
  screenSubtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  syncStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 4, maxWidth: 140 },
  syncDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  syncDotError: { backgroundColor: colors.red },
  syncStatusText: { fontSize: 10, color: colors.muted, fontWeight: '600' },
  summaryCard: { marginHorizontal: 16, backgroundColor: colors.navy, borderRadius: 22, padding: 17, borderWidth: 1, borderColor: '#214861', shadowColor: '#0B2937', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 3 },
  summaryTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryEyebrow: { color: colors.gold, fontSize: 9, letterSpacing: 1.2, fontWeight: '700' },
  summaryTitle: { color: colors.white, fontSize: 15, fontWeight: '600', marginTop: 4 },
  summaryMark: { width: 32, height: 32, borderRadius: 11, backgroundColor: 'rgba(245,183,25,0.13)', borderColor: 'rgba(245,183,25,0.22)', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  summaryMetrics: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  summaryMetric: { flex: 1, minWidth: 0 },
  metricDivider: { width: 1, height: 38, backgroundColor: 'rgba(255,255,255,0.17)', marginHorizontal: 15 },
  metricLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  spentDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#F5B719' },
  earnedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#72C69A' },
  summaryMetricLabel: { color: '#D6E0E7', fontSize: 11 },
  summaryMetricValue: { color: colors.white, fontSize: 16, fontWeight: '700', marginTop: 5, letterSpacing: -0.25 },
  summaryFootnote: { color: '#B8C8D2', fontSize: 9, marginTop: 13, lineHeight: 14 },
  searchAndFilter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 15 },
  searchField: { height: 46, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, backgroundColor: colors.surfaceGlass, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)', borderRadius: 14, shadowColor: colors.navy, shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 12, color: colors.ink, paddingVertical: Platform.OS === 'android' ? 0 : 8 },
  filterButton: { minHeight: 44, maxWidth: 100, borderRadius: 13, paddingHorizontal: 11, backgroundColor: colors.surfaceGlass, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  filterActive: { backgroundColor: colors.goldTint, borderColor: '#E8C663' },
  filterLabel: { color: colors.body, fontSize: 11, fontWeight: '600' },
  filterLabelActive: { color: colors.goldDeep },
  syncBanner: { marginHorizontal: 16, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: '#E8F0F3', flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorBanner: { backgroundColor: '#F8EAE6' },
  syncBannerText: { flex: 1, color: colors.body, fontSize: 10, lineHeight: 15 },
  retryText: { color: colors.goldDeep, fontSize: 11, fontWeight: '700', padding: 3 },
  listLabelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 17, paddingBottom: 5 },
  listLabel: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  resultCount: { color: colors.muted, fontSize: 10 },
  listContent: { paddingBottom: 14 },
  monthHeader: { backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 8 },
  monthHeadingLine: { minHeight: 23, flexDirection: 'row', alignItems: 'center', gap: 7 },
  monthTitle: { fontSize: 14, fontWeight: '700', color: colors.navy },
  soFarPill: { color: colors.goldDeep, backgroundColor: colors.goldTint, overflow: 'hidden', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
  resultsPill: { color: colors.blue, backgroundColor: '#E7EEF1', overflow: 'hidden', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, fontSize: 8, fontWeight: '700', letterSpacing: 0.4 },
  monthTotalsRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 4 },
  spentSummary: { color: colors.muted, fontSize: 9 },
  earnedSummary: { color: colors.muted, fontSize: 9 },
  monthTotalValue: { color: colors.body, fontWeight: '700' },
  countSummary: { marginLeft: 'auto', color: colors.muted, fontSize: 9 },
  fxFootnote: { color: colors.goldDeep, fontSize: 9, marginTop: 4 },
  transactionRow: { minHeight: 68, paddingHorizontal: 15, paddingVertical: 11, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowPressed: { opacity: 0.74, backgroundColor: '#FBF7E9' },
  merchantIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#EDF2F4', alignItems: 'center', justifyContent: 'center' },
  transferIcon: { backgroundColor: '#EEF0F1' },
  incomeIcon: { backgroundColor: '#EAF3ED' },
  transactionInfo: { flex: 1, minWidth: 0 },
  merchantLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  merchant: { flexShrink: 1, color: colors.ink, fontSize: 12, fontWeight: '700' },
  pendingChip: { color: colors.goldDeep, backgroundColor: colors.goldTint, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden', fontSize: 8, fontWeight: '700', textTransform: 'uppercase' },
  transactionMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
  transferNote: { color: colors.muted, fontSize: 9, marginTop: 3 },
  fxEquivalent: { color: colors.blue, fontSize: 9, marginTop: 4, fontWeight: '600' },
  amountColumn: { minWidth: 86, alignItems: 'flex-end', maxWidth: 128 },
  transactionAmount: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  mutedAmount: { color: colors.muted },
  earnedAmount: { color: colors.green },
  transactionTime: { color: colors.muted, fontSize: 9, marginTop: 4 },
  listFootnote: { color: colors.muted, fontSize: 10, lineHeight: 15, paddingHorizontal: 18, paddingTop: 13 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 38, paddingBottom: 45 },
  emptyIcon: { width: 54, height: 54, borderRadius: 19, backgroundColor: '#E7EEF1', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  emptyRetry: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', backgroundColor: colors.gold, borderRadius: 13, marginTop: 16 },
  emptyRetryText: { color: colors.navy, fontSize: 12, fontWeight: '700' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalScrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(5,25,38,0.42)' },
  detailSheet: { maxHeight: '91%', backgroundColor: colors.background, borderTopLeftRadius: 25, borderTopRightRadius: 25, paddingHorizontal: 20, paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 30 : 20 },
  sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#C7D0D4', marginBottom: 15 },
  sheetTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetEyebrow: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  closeButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  detailMerchant: { color: colors.ink, fontSize: 22, fontWeight: '700', marginTop: 12 },
  detailCategory: { color: colors.muted, fontSize: 11, marginTop: 4 },
  detailAmount: { color: colors.ink, fontSize: 26, fontWeight: '700', marginTop: 14 },
  detailFx: { color: colors.blue, fontSize: 11, marginTop: 5 },
  detailNote: { color: colors.body, backgroundColor: colors.goldTint, padding: 11, borderRadius: 12, fontSize: 10, lineHeight: 15, marginTop: 12 },
  detailRows: { marginTop: 13 },
  detailRow: { minHeight: 39, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  detailLabel: { color: colors.muted, fontSize: 10 },
  detailValue: { color: colors.body, fontSize: 10, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  technicalToggle: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  technicalToggleText: { color: colors.blue, fontSize: 11, fontWeight: '700' },
  technicalBox: { maxHeight: 180, backgroundColor: '#E9EEF0', padding: 11, borderRadius: 12, marginTop: 10 },
  technicalLabel: { color: colors.blue, fontSize: 9, fontWeight: '700', marginBottom: 6 },
  technicalRaw: { color: colors.body, fontSize: 8, lineHeight: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  settingsRoot: { flex: 1, justifyContent: 'center', padding: 18 },
  settingsCard: { backgroundColor: colors.background, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.88)' },
  settingsTitle: { color: colors.ink, fontSize: 20, fontWeight: '700', marginTop: 9 },
  settingsDescription: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  inputLabel: { color: colors.body, fontSize: 10, fontWeight: '700', marginTop: 19, marginBottom: 7 },
  serverInput: { height: 46, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.surface, paddingHorizontal: 12, color: colors.ink, fontSize: 12 },
  settingsHint: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 8 },
  saveButton: { height: 46, borderRadius: 13, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', marginTop: 19 },
  saveButtonDisabled: { opacity: 0.58 },
  saveButtonText: { color: colors.navy, fontSize: 12, fontWeight: '700' },
});
