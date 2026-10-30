# Simplify Money Track

An Expo / React Native implementation of Track for the Simplify Money frontend assignment. It uses the assignment’s navy, gold and warm off-white palette and the supplied Simplify Money mark. Expo managed workflow was chosen so the same app can run in Expo Go during development and produce an installable Android APK through EAS.

> **Submission status:** the app, mock API integration, offline cache, automated checks and draft PR review are in place. The real-app Task 1 teardown, personal Task 0 activities, physical-device failure walkthrough, TalkBack review, performance measurements, APK artifact and recording still need to be completed. This README marks these clearly; it does not claim those steps happened.

## Quick start (Windows)

Requirements: Node.js (Node 22.6+ for the included test command), npm, a phone with Expo Go, and the phone and computer on the same Wi-Fi. Android Studio/SDK is optional for the Expo Go route.

Open PowerShell in this folder:

```powershell
npm.cmd install
git clone https://github.com/simplify-money/track-api-mock.git ..\track-api-mock
npm.cmd run demo
```

The demo script starts the mock API and Expo. Scan the QR code with Expo Go. The terminal prints the phone API address; both the phone and computer must be able to reach that address on the same network. If the app cannot connect, open **Settings** in the app and enter the printed `http://<computer-LAN-IP>:4010` address. Allow Node through Windows Firewall on the private network if Windows asks.

In this workspace the API clone is also detected at `..\work\track-api-mock`. For another location, set `TRACK_API_DIR` before starting:

```powershell
$env:TRACK_API_DIR = 'C:\path\to\track-api-mock'
npm.cmd run demo
```

The mock server can be run separately if needed:

```powershell
node ..\track-api-mock\server.js
```

Then in another terminal run `npm.cmd start`. Configure the base URL in the app’s Settings screen. `npm.cmd run dev` starts Expo only; it does not start the API.

### Android emulator or installable APK

For an Android emulator, install Android Studio and its SDK/Platform Tools, start an emulator, then run:

```powershell
npm.cmd run demo -- --android
```

If the SDK or `adb` is missing, the demo script falls back to the QR / Expo Go route. For a physical Android device, Expo Go does not require the full Android SDK. The phone and PC still need to be on the same Wi-Fi to reach the local mock API.

An APK can be built with EAS (not yet built for this submission):

```powershell
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

The preview profile is configured as an internal Android APK in [eas.json](eas.json), with application ID `in.simplifymoney.trackassignment`. EAS may ask to link this project to your Expo account. After the cloud build finishes, install the downloaded APK. In the app’s Settings, use the PC’s LAN address, for example `http://192.168.1.20:4010`. This assignment mock uses plain HTTP on a local development network; use HTTPS for a production service.

## What is implemented

- Month-grouped transaction history with monthly spend and income totals, merchant/category search, income and expense filters, and transaction detail.
- A normalization layer for the API’s legacy and newer transaction shapes; stable transaction identity, duplicate removal across pages, and latest-version selection.
- Exact minor-unit money arithmetic and Indian rupee formatting. Own-account transfers are excluded from spend and income; ordinary peer-to-peer transfers remain classified by their transaction semantics.
- INR-converted totals for foreign-currency transactions while preserving their original amount and currency for detail.
- IST month grouping, including dates near UTC month boundaries.
- SQLite-backed local transactions and sync metadata. The list can render the saved snapshot while the server is unavailable.
- Full and incremental synchronization, deletion/tombstone handling, expired-token full resync, serialized concurrent syncs, and failed-sync protection so an incomplete response does not replace the saved snapshot.
- Accessible labels on key controls, pull to refresh, connection/sync status, and settings for the API base URL.

These describe implementation and automated coverage. Phone-level kill-mid-sync, airplane-mode restart, and screen-reader behavior still need the walkthrough below.

## Run checks

```powershell
npm.cmd run typecheck
npm.cmd test
```

The tests reconcile the checked-in mock fixture to **4,686 unique transactions across 13 months** and exercise normalization, money/date rules, incremental updates, tombstones, expired-token recovery, failure safety and concurrent sync behavior. Fixture checks do not replace a test against a separately supplied data set.

## Reviewer walkthrough

Use this sequence to inspect the app and capture the requested evidence:

1. Start the mock and app using Quick start. Wait for the first full sync; confirm the list contains 4,686 transactions.
2. Open October 2026 and compare totals with the checkpoint table below. The Android screenshot already shared during development showed **₹1,09,784.98 spent** and **₹2,45,135.00 earned** for October, plus 4,686 transactions and the Income filter. A safe-area adjustment was made afterward; reload the app and capture a fresh screenshot to confirm it on the current build.
3. Search for a merchant, clear the query, apply a filter, and open a transaction. Check its amount, date/time, account, category, original currency (if applicable), and available raw details.
4. Pull to refresh and verify the UI reports the result. For failure behavior, stop the API during a refresh and confirm the previously visible history remains. Restart the API and refresh again.
5. With the history cached, enable airplane mode and fully close/reopen the app. Confirm the saved history remains visible, then reconnect and refresh.
6. Run `npm.cmd test` and `npm.cmd run typecheck` and capture the passing terminal output.

The phone-level offline and interrupted-sync steps have **not yet been witnessed or recorded**. Include them in the final video only after doing them on the device. The assignment requests a recording of at most five minutes; a suggested order is first launch/full history, checkpoint comparison, search, detail, interrupted sync, airplane-mode restart, online recovery, and test output.

### Fixture checkpoints

All amounts are INR. These are expected fixture totals, not measurements from a user account.

| Month | Spent | Earned |
|---|---:|---:|
| October 2025 | ₹2,85,256.89 | ₹2,44,805.00 |
| November 2025 | ₹2,51,218.81 | ₹2,40,751.21 |
| December 2025 | ₹2,61,814.21 | ₹2,43,519.00 |
| January 2026 | ₹2,53,763.67 | ₹2,48,328.85 |
| February 2026 | ₹4,43,341.40 | ₹2,48,016.00 |
| March 2026 | ₹2,55,162.31 | ₹2,47,997.71 |
| April 2026 | ₹2,26,178.29 | ₹14,79,390.89 |
| May 2026 | ₹2,07,873.13 | ₹2,48,306.00 |
| June 2026 | ₹2,40,821.73 | ₹2,49,824.23 |
| July 2026 | ₹2,74,425.98 | ₹2,49,117.00 |
| August 2026 | ₹2,60,648.90 | ₹2,44,791.52 |
| September 2026 | ₹2,39,609.82 | ₹2,46,811.00 |
| October 2026 | ₹1,09,784.98 | ₹2,45,135.00 |

## Data findings and choices

The mock data is intentionally irregular. The implementation makes these choices:

| Data observed | Choice in this app | Follow-up with more time |
|---|---|---|
| Legacy and newer field layouts coexist | Normalize both into one internal transaction model | Add contract examples for every server version |
| Page boundaries can repeat records | Deduplicate by canonical transaction identity | Ask the API for a stable opaque transaction key |
| Records can arrive out of order or be revised | Keep the latest version using update/version metadata | Define server-side ordering and conflict semantics |
| Deletions are represented by tombstones | Apply tombstones during incremental sync | Verify retention and replay guarantees with the API owner |
| A token can expire during incremental sync | Fall back to a full sync | Exercise token expiry on a live phone walkthrough |
| Own-account transfers appear alongside income and spending | Exclude explicit own-account transfers from both totals | Validate account-linking edge cases with product/data owners |
| Foreign-currency records carry INR conversion data | Sum INR minor units and retain original currency in details | Show conversion provenance and rate date in the UI |
| Month boundaries depend on India time | Group by IST calendar month | Confirm the product’s policy for future timezone changes |
| Categories or merchant text may be missing or Unicode-varied | Provide a fallback category and normalized case-insensitive search | Add explicit language/merchant alias handling |
| Backend summary values can disagree with transaction rows | Derive displayed totals from normalized transactions | Investigate each discrepancy with the API owner |

The fixture tests include 4,686 unique records, 13 months, 50 own-account transfers, 15 foreign-currency transactions, 43 records whose UTC and IST month differ, and late/revised records. These counts describe the checked-in fixture; they are not assumptions embedded as fixed production data.

## Decision log (draft for author review)

These are the implementation decisions. Before submitting, rewrite this section in your own voice and add what you personally considered uncertain; do not present it as a personal reflection until you have reviewed it.

1. **Expo managed workflow:** selected for quick Expo Go testing and an EAS APK path. A bare React Native project would give more native control but added setup before the core data behavior was validated.
2. **SQLite for the source of the offline list:** selected so a failed network request can leave the last committed view available. In-memory state alone would lose it after restart.
3. **SectionList for month groups:** selected for native section headers and straightforward month navigation. A recycled-list library may be preferable if measured scrolling shows this list is not smooth enough.
4. **Calculate totals from normalized transactions:** selected because a summary endpoint can diverge from the rows a user sees. The cost is local aggregation work, so performance should be measured on a mid-range device.
5. **Use IST for calendar grouping:** selected because users are in India and UTC dates around midnight can belong to a different local month.
6. **Exclude only explicit own-account transfers:** selected to avoid counting money movement between linked accounts as spend or income while retaining unrelated transfers according to their actual direction/type.
7. **Use converted INR for totals, retain source currency in detail:** selected so totals are comparable while the underlying foreign-currency transaction remains understandable.
8. **Use update/version metadata and tombstones:** selected so edits and deletes supersede stale local rows. A plain insert-only sync would leave outdated amounts or deleted records visible.
9. **Commit sync results atomically and serialize sync calls:** selected so partial page failure cannot replace a good snapshot and racing requests cannot interleave writes.

## Task 1 — real Track teardown

**Not completed yet.** The implementation work started before a first-hand session with the official Track experience, so this README does not invent speed observations or examples of incorrect/confusing data.

Before submission, use the real app and data source to scroll back several months, search, open a transaction, pull to refresh, and turn the network off and on. Capture screenshots. Write 1–2 pages stating where it felt fast or slow, show at least two confusing or incorrect examples, and name three changes with reasons. Include device, app version, date, and network conditions. Save the result and screenshots under `docs/` and link them here.

## Task 3 — PR #412 review

The current draft is in [docs/pr-review.md](docs/pr-review.md). It contains up to ten prioritized comments with a merge recommendation and rationale. Read the diff and review text yourself before submission, and ensure each concern is also handled in this implementation.

## Stretch work

The chosen stretch direction is **sync that holds up**. Automated tests cover incremental updates, tombstones, expired-token recovery, concurrent sync calls, and preserving data when a sync fails. The real-device kill-mid-sync and airplane-mode restart scenarios remain unverified. Performance numbers and TalkBack/VoiceOver review have not been done; no claims are made for them.

If you choose the performance stretch, measure on a named mid-range Android device with the full history loaded, record the test procedure and before/after values, and avoid reporting emulator numbers as phone measurements. If you choose accessibility, use TalkBack through the core flows and document each issue found and fixed.

## Assignment submission checklist

- [ ] Complete Task 0 from the assignment: install/use the official app, gather the requested friend feedback/referrals, and prepare the one-page summary.
- [ ] Complete and attach the real-app Task 1 teardown with screenshots.
- [ ] Review and personalize the decision log and PR review.
- [ ] Reload on the phone and confirm the safe-area change; record the complete offline/interrupted-sync walkthrough.
- [ ] Build and install an Android APK, then verify its API URL reaches the mock server.
- [ ] Record and link the walkthrough video (maximum five minutes).
- [ ] Decide whether to complete performance or TalkBack stretch; report only evidence actually collected.
- [ ] Add a concise AI disclosure and one concrete example of an AI output that was wrong or worse than your own version.
- [ ] List unfinished work honestly, then prepare the repository, CV and submission email as the assignment requests.

## AI use and unfinished work

OpenAI Codex assisted with design research, implementation, documentation and debugging. One concrete correction: the initial design deliverable was HTML only, which did not satisfy the requested Expo/React Native app. It was then carried into this Expo app. Before submission, add a specific code or data example of an AI suggestion you rejected or corrected and explain the difference in your own words.

Still outstanding: first-hand official-app teardown, Task 0 activities, personal edits to this decision log and PR review, confirmation of the latest safe-area fix on the phone, phone-level airplane-mode and interrupted-sync walkthrough, TalkBack audit or measured performance stretch, EAS APK build/install, and the five-minute recording. No APK or video has been produced yet.

## Project map

- `App.tsx` — Track screen and interactions
- `src/` — API normalization, money/date logic, persistence and sync behavior
- `tests/` — core and sync regression tests
- `scripts/run-demo.mjs` — start mock API and Expo with phone-reachable LAN configuration
- `docs/pr-review.md` — draft Task 3 review
- `assets/SM_Logo_White_Gold.png` — supplied company logo
