# Project Progress

## Current Verified State

- Repository state: reliability fix `296a510` published to `main`; updater collected snapshot `fb21dfa` and the resulting Pages deployment passed
- Standard bootstrap: `scripts/bootstrap.sh`
- Standard start: `npm run dev`
- Standard verification: `npm run verify`
- Baseline result: `npm run verify` passed on 2026-10-02 with 50 Python tests, archive/data validation, 64 frontend tests, build, and production smoke for all 30 daily bundles
- Active feature: none; `REPO-002` passed local and GitHub Actions verification
- Current blocker: none
- Next best action: monitor subsequent scheduled runs, especially unpublished early-morning source dates; the updated workflows are deployed

## Verified Behavior

| Feature | Evidence | Repository state |
| --- | --- | --- |
| `RADAR-001` | `npm run verify` passed: 9 Python tests, validation, 18 frontend tests, build, and production-preview static-file checks | working tree based on `3a40637` |
| `DATA-001` | Pages run `32927193299`; deployed `latest.json` reported `source.id=yulog` and `isMock=false` | `3a40637` |
| `DATA-002` | Live generation produced 433 JR Central services, 409 mapped services, and 10 attach/detach splits; `npm run verify` passed | working tree based on `3a40637` |
| `RADAR-002` | `npm run verify` passed with route-class, full-segment overlap, reverse-direction, chronological-order, UI disclosure, build, and preview coverage | working tree based on `a1cf946` |
| `REPO-001` | Ignore-rule audit found no ignored tracked files, preserved all three public deployment snapshots, and `npm run verify` passed | working tree based on `27844c7` |
| `DATA-003` | Live generation produced 433 JR services, 409 mappings, 161 planned-metadata segments, and 48 current assignments; full verification passed without a direct Yulog request | working tree based on `27844c7` |
| `RADAR-003` | `npm run verify` passed with direct-train preservation and known/possible cross-seat filtering coverage for both indirect route types | working tree based on `27844c7` |
| `RADAR-004` | `npm run verify` passed with constrained earliest-arrival, feeder/onward, missed-connection, reverse-direction, live-data, localized UI, build, and smoke coverage | working tree based on `27844c7` |
| `RADAR-005` | `npm run verify` passed with four filter categories, minimum featured-ride boundaries, per-leg formation/seating UI, build, and smoke coverage | working tree based on `27844c7` |
| `RADAR-006` | `npm run verify` passed with the exact 763M latest-feeder regression, exhaustive indirect-route consistency, adversarial tie-breaking, reverse-direction, overnight, build, and smoke coverage | working tree based on `27844c7` |
| `RADAR-007` | `npm run verify` passed with cached feeder/onward profiles, pre-planning formation filtering, a 1.5-second regression budget, build, and smoke; the 202-candidate 06:00 audit measured about 0.33 seconds | working tree based on `27844c7` |
| `RADAR-008` | `npm run verify` passed with one localized Tokaido corridor identifier, no duplicate subtitle, independent-service disclosure, all 55 frontend tests, build, and smoke; headless Firefox covered mobile, desktop, direct, and four-leg indirect layouts | working tree based on `27844c7` |
| `RADAR-009` | `npm run verify` passed with 27 Python tests, 64 frontend tests, archive validation, build, and production smoke for 15 dated bundles; Git backfill recovered August 27–September 8 | working tree based on `25fbadf`; recovered records from `origin/main` at `e24ee78` |
| `REPO-002` | Local and hosted full verification passed with 50 Python tests, 64 frontend tests, build, and smoke for 30 bundles; Pages runs `37006529446`/`37006717296` and live updater `37006657728` passed | fix `296a510`; updater snapshot `fb21dfa` |

## Known Failures and Risks

- External-source availability, reuse permission, attribution, request frequency, and the configured `OPERATION_REVISION` remain operational dependencies.
- The Tokaido Shizuoka current-assignment JSON mirrors Yulog-provided data; the mirror removes a direct API dependency but does not remove upstream provenance or permission concerns.
- JR Central can publish some services without a matching community operation record; these remain visible with an unknown formation.
- The current collected 30-day archive contains every date from September 3 through October 2. Collection began August 26; the archive retains the rolling window and the UI explicitly marks unrecorded dates unavailable.
- Source publication time is not guaranteed. Release estimates use yesterday's first successful same-day collection, when recorded; imported historical data has no first-release observation, so the UI initially shows the next half-hour scheduled check.
- Subsequent investigation confirmed dated formation archives at `https://tokaido-unyo-shizuoka.com/json/unyo/2026/unyo-data-20260812.json` (including August 12 assignments). Direct formation-archive backfill is not implemented; historical JR Central station-by-station timetable availability remains unverified. Scheduled collection has since populated all 30 dates in the current rolling window.
- GitHub's observed trigger frequency is much lower than the half-hour cron: the latest seven-day inspection contained 35 updater runs, with a median gap of about 4 hours 45 minutes. Delayed/dropped triggers are outside these repository fixes; the half-hour schedule and UI check estimates remain unchanged.
- Source outages can still exhaust bounded retries and fail visibly. A successful no-update result means only that source dates are unpublished and the existing real snapshot pair/archive passed validation; it does not relabel old data as fresh.
- Updated workflows have passed hosted full verification, a live manual data refresh, and Pages deployment. The no-update path is covered by offline real-parser regressions; its next naturally unpublished scheduled run remains to be observed.
- Complete-route calculations use scheduled times only. Platform movement, delays, and guaranteed connections are unavailable, so a departure at the same minute as arrival is considered schedulable but is not guaranteed physically feasible.

## Decisions

- The browser reads only generated static JSON; Python adapters own all source-site access.
- Unknown or unverified formations remain `unknown` rather than receiving inferred seating.
- Failed data generation must leave the last valid JSON intact.
- Historical timetable/formation pairs use immutable content-addressed bundles. The validated index is published last, and obsolete previously indexed files are pruned afterward. The archive retains today and the preceding 29 JST dates.
- User preference: always maintain the rolling last-30-calendar-day window. Scheduled updates use full Git history to backfill missing recorded dates. Recovery validates same-commit pairs, preserves existing archived dates and first observations, rejects shallow history, and does not relabel or invent missing data.
- The browser defaults to today if available, otherwise the newest archived date; manual date selection is retained until changed or reloaded. Historical searches apply the entered clock time to the selected date, without treating it as an overnight continuation.
- The updater fetches each existing feed once per successful refresh and parses matching available dates with existing coverage checks. Missing today's data does not prevent a valid historical refresh. No new external source is enabled.
- The Actions updater passes `--allow-unavailable`: missing/empty assignments, unpublished timetables, and incomplete past dates preserve a validated saved real pair and report waiting for publication. CLI calls without the flag remain strict. Schema errors, partial current-day coverage, low mapping coverage, invalid saved data, and exhausted transport retries remain failures.
- Existing source requests use a 30-second timeout, at most three attempts for transient transport/HTTP failures, 5/15-second backoff, and bounded numeric `Retry-After` support. Permanent HTTP errors and malformed JSON fail immediately. Generated-data pushes retry the same commit at most three times without rebasing or force-pushing.
- Successful data refreshes only build/deploy Pages when `public/data` differs from the triggering updater's starting revision. Main-branch pushes and manual Pages dispatches still run full verification and build.
- Exact itinerary assertions use an immutable four-service September 9 fixture with recorded Git provenance. Changing daily data remains covered by full itinerary consistency checks. Stop times are parsed once per planner; the unchanged 1.5-second bulk-query limit now includes planner construction.
- Tokaido Shizuoka mode refreshes and validates both `timetable.json` and `latest.json` before replacing either last-good snapshot.
- The legacy source selector `yulog` resolves to the Tokaido Shizuoka adapter during rollout so the existing external Actions variable cannot break scheduled updates.
- JR Central is authoritative for every displayed station time; operation-table times are not imported into the static timetable.
- Complete current assignments override planned data. Planned fallback is allowed only when no current record exists for the segment and every diagram has one exact family (`U` or `F`); partial, malformed, or mixed-family coverage remains unknown.
- Planned formations are visibly disclosed. Unverified families such as `F` may be named but keep unknown seat status and car counts.
- Search includes same-direction trains sharing at least one full segment with the selected corridor; a one-station touch is excluded.
- Intermediate-overlap times and formation are shown at the start of the shared segment, with no claim that a connection is feasible.
- Direct trains remain visible regardless of seating. First-leg and intermediate-overlap trains are hidden only when the formation at the displayed overlap start is confirmed all-longitudinal; unknown formations remain as possible cross-seat results.
- Each indirect result must have an earliest-arrival same-direction itinerary that boards the featured train at its displayed overlap start and reaches the selected destination. The planner may transfer before the featured terminal; overlaps without a complete itinerary are hidden.
- Every feeder, featured, and onward leg is classified independently at its boarding station. Filters can hide direct longitudinal, direct unknown, or indirect unknown results, and can require a minimum scheduled duration aboard the featured indirect train; defaults preserve prior visibility and do not persist across sessions.
- Complete-route searches reuse Pareto-safe feeder and onward profiles across every matching train in the same query; candidates already excluded by formation settings are removed before journey planning.
- Generated build output, caches, logs, environments, editor files, and interrupted atomic-write scratch files are ignored.
- Final `public/data/*.json` snapshots remain tracked because the static site and scheduled updater require them.
- The passenger theme uses JR Central's published orange-and-white corporate color pairing and railway-information geometry without reproducing its logo; the interface identifies itself as an independent, unofficial guide.

## Latest Session

- Date: 2026-10-02
- Goal: inspect and fix recurring GitHub Actions failures
- Inspection: all 467 available runs (August 26–October 2) included 54 updater failures and eight Pages failures. Updater failures comprised 42 unpublished/empty/mismatched-date cases, 11 source timeouts, and one GitHub `commit_refs` rejection. Pages failures comprised five fixed-route mismatches, one 1.5-second performance-budget failure, and two historical seat-category assertion failures.
- Baseline: fast-forwarded the clean checkout from `4cde975` to `d7d97d2`; reproduced the latest Pages failure locally (`1425M → 763M → 431M → 959M` instead of the fixed September route).
- Before publication: rebased the prepared fix onto the newer bot data commit `518928e`, then reran `npm run verify` successfully with the same 50 Python tests, 64 frontend tests, build, and smoke for all 30 bundles.
- Changed: added typed source unavailability, opt-in validated no-update handling and an Actions summary; centralized bounded read retries for the existing feeds; added same-commit push retries and unchanged-data deployment gating; moved the exact feeder regression to a fixed four-service fixture and cached parsed stop times in the planner.
- Verification: `npm run verify` passed with 50 Python tests, 64 frontend tests, static/archive validation, production build, and production-preview smoke for all 30 indexed daily bundles. Regression coverage includes real-parser unpublished feed responses, byte-preserving fallback, malformed/partial-source rejection, retry recovery/exhaustion, push retry limits, and deployment output decisions. Both workflow YAML files parsed and job dependencies resolved.
- Live evidence: generated into `.tmp/ci-refresh/data` from the already-enabled sources and validated October 2 with 416 official services and 61 assignments. Historical date gaps were reported as unavailable; no files under `public/data` changed.
- Publication: under the user's October 2 approval, committed/pushed fix `296a510`. [Pages run `37006529446`](https://github.com/iks-ran/shizuoka-cross-radar/actions/runs/37006529446) passed full verification and deployed successfully.
- Hosted updater: dispatched [data run `37006657728`](https://github.com/iks-ran/shizuoka-cross-radar/actions/runs/37006657728) once to verify the revised workflow. All steps passed, preserving the existing archive and pushing snapshot `fb21dfa` with 416 services and 65 assignments. Fast-forwarded the local checkout to that collected snapshot.
- Follow-up deployment: [Pages run `37006717296`](https://github.com/iks-ran/shizuoka-cross-radar/actions/runs/37006717296) detected the changed data, passed 50 Python tests, 64 frontend tests, production build and smoke for all 30 bundles, then deployed successfully.
- Next action: monitor later scheduled no-update/update runs. Upstream publication timing and GitHub schedule delays remain external limits.

## Previous Session

- Date: 2026-09-10
- Goal: resolve the midnight data gap with historical date selection and useful availability information
- Changed: added immutable paired daily archives, index validation and workflow retention, a localized date selector with automatic fallback, historical observation labels, and separate yesterday-based estimate / next scheduled check messages. Added offline archive seeding, Git-history backfill, full-depth workflow checkout, explicit 30-date coverage display, and extended production smoke coverage.
- Live evidence: the existing formation feed exposed September 5–9, but matching official corridor coverage passed only for September 9. September 10 assignments were still unpublished. Archived September 9 and the saved August 26 pair; refreshed compatibility snapshots to September 9. First-release observations remain null for these historical imports.
- Backfill evidence: fetched `origin/main` at `e24ee78` and recovered 13 missing dates (August 27–September 8). All 15 days from August 26 through September 9 now have validated pairs. A repeated backfill recovered zero dates and preserved existing records. Before the user-requested push, rebased the implementation onto `e24ee78`, resolving only the two compatibility snapshot timestamps in favor of the newer validated data.
- Verification run: `npm run verify` passed with 27 Python tests, static/archive validation, 64 frontend tests, production build, and preview smoke serving the index and all 15 bundles. Regressions additionally cover newest valid Git pairs, mismatched/fixture rejection, shallow-history rejection, idempotent recovery, and disabled unrecorded dates.
- Artifacts: `.tmp/preview-smoke.log` and build/test caches are ignored verification artifacts.
- Publication: user requested commit and push to `main`, which triggers the existing Pages workflow. Local verification does not establish deployment success.
- Next action: check Pages workflow results after push; scheduled updates will retain the rolling archive and collect first-release observations automatically.
