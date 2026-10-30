# PR #412 review

Review of `work/track-api-mock/review/` (most important first).

1. **Block — the current types crash on legacy rows.** The list contains both the newer schema and legacy `txn_time`/`amount`/`DR` rows. `occurred_at.slice()` and `amount_minor` fail on legacy data. Normalize both shapes and skip malformed records.
2. **Block — request failure wipes the history.** The hook clears transactions in `catch` and the screen replaces the list with an error. It also does not check `response.ok`. Keep the committed snapshot and show an inline retry state.
3. **Block — page boundaries duplicate transactions.** The mock re-sends the last row of one page as the first row of the next. Appending raw arrays creates duplicates; index keys then make updates unstable. Merge by raw ID and key rows by ID.
4. **Block — displayed money is incorrect.** Float sums include own transfers, omit income, treat USD as rupees and ignore INR FX values. En-US grouping also misformats lakh values. Use integer paise, transfer rules, FX equivalents and Indian grouping.
5. **Block — month buckets use UTC and totals can be partial.** At least some transactions land in a different month under IST. A month header must not present a partially loaded total as final.
6. **Block — there is no sync or offline model.** Without changes, persisted snapshots or tombstones, the screen cannot reflect edits/deletes or show data after an offline launch.
7. **Block — concurrent loads can overwrite newer data.** `loadMore` and refresh share stale closure state and lack single-flight/generation guards. An older response must not replace a newer snapshot.
8. **Allow with follow-up — list work is repeated per render.** The current regrouping and flattening are avoidable for the full history. Precompute view models per committed snapshot and virtualize by section.
9. **Allow with follow-up — endpoint configuration and retry behavior are missing.** The hard-coded URL, missing timeout and ignored `Retry-After` make device use and injected failures unreliable.
10. **Block — core behavior and accessibility are untested.** Add tests for money, normalization, totals, dedupe, IST, sync failures, search and accessible row labels before relying on the screen.

The app now uses normalized records, integer totals, stable IDs, SQLite snapshots, incremental sync with retries, local search, and labeled interactive rows. `npm.cmd test` includes fixture reconciliation; the remaining real-device and manual checks are listed in the README.
