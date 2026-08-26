# Project Progress

## Current Verified State

- Repository state: `main` change set rebased onto `8d50a60` with verified source consolidation, responsive complete indirect-route planning, robust route ranking, per-leg seating, result filters, and JR Central-inspired passenger theme
- Standard bootstrap: `scripts/bootstrap.sh`
- Standard start: `npm run dev`
- Standard verification: `npm run verify`
- Baseline result: `npm run verify` passed on 2026-08-26 with 16 Python tests, data validation, 55 frontend tests, build, and production smoke
- Active feature: none; `RADAR-008` passed verification
- Current blocker: none
- Next best action: rename the external Actions source variable when operationally convenient; deployment remains approval-gated

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

## Known Failures and Risks

- External-source availability, reuse permission, attribution, request frequency, and the configured `OPERATION_REVISION` remain operational dependencies.
- The Tokaido Shizuoka current-assignment JSON mirrors Yulog-provided data; the mirror removes a direct API dependency but does not remove upstream provenance or permission concerns.
- JR Central can publish some services without a matching community operation record; these remain visible with an unknown formation.
- A previous-day live timetable is intentionally withheld until the next successful Tokyo-date update.
- Complete-route calculations use scheduled times only. Platform movement, delays, and guaranteed connections are unavailable, so a departure at the same minute as arrival is considered schedulable but is not guaranteed physically feasible.

## Decisions

- The browser reads only generated static JSON; Python adapters own all source-site access.
- Unknown or unverified formations remain `unknown` rather than receiving inferred seating.
- Failed data generation must leave the last valid JSON intact.
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

- Date: 2026-08-26
- Goal: align the passenger interface with JR Central's visual language
- Changed: replaced the teal civic-service treatment with an orange, white, and charcoal hierarchy; added a CSS-rendered CA line identifier and localized Tokaido corridor label; removed the redundant corridor subtitle below the title; tightened timetable cards and journey legs; preserved accessible seat-category colors; removed the misleading `JR CENTRAL` masthead copy; and added a localized independent-service disclosure
- Verification run: `npm run verify` passed after rebasing over the latest remote data snapshots, with 16 Python tests, static-data validation, 55 frontend tests, production build, and preview smoke; headless Firefox inspection covered a 500 px mobile layout, a 1280 px desktop layout, direct results, and an Atami-to-Toyohashi four-leg indirect itinerary
- Artifacts: `.tmp/theme-mobile-rendered.png`, `.tmp/theme-desktop-rendered.png`, `.tmp/theme-indirect-rendered.png`, and `.tmp/preview-smoke.log` are ignored local verification artifacts
- Unverified: no external deployment was run; deployment requires user approval
- Next action: renaming the external Actions source variable and deployment remain approval-gated
