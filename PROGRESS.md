# Project Progress

## Current Verified State

- Repository state: working tree based on `a1cf946` with route-overlap search changes not yet committed
- Standard bootstrap: `scripts/bootstrap.sh`
- Standard start: `npm run dev`
- Standard verification: `npm run verify`
- Baseline result: `npm run verify` passed on 2026-08-26 with 13 Python tests, data validation, 22 frontend tests, build, and production smoke
- Active feature: none
- Current blocker: none
- Next best action: obtain user approval before deploying the verified route-overlap search and real-data integration

## Verified Behavior

| Feature | Evidence | Repository state |
| --- | --- | --- |
| `RADAR-001` | `npm run verify` passed: 9 Python tests, validation, 18 frontend tests, build, and production-preview static-file checks | working tree based on `3a40637` |
| `DATA-001` | Pages run `32927193299`; deployed `latest.json` reported `source.id=yulog` and `isMock=false` | `3a40637` |
| `DATA-002` | Live generation produced 433 JR Central services, 409 mapped services, and 10 attach/detach splits; `npm run verify` passed | working tree based on `3a40637` |
| `RADAR-002` | `npm run verify` passed with route-class, full-segment overlap, reverse-direction, chronological-order, UI disclosure, build, and preview coverage | working tree based on `a1cf946` |

## Known Failures and Risks

- External-source availability, reuse permission, attribution, request frequency, and the configured `OPERATION_REVISION` remain operational dependencies.
- JR Central can publish some services without a matching community operation record; these remain visible with an unknown formation.
- A previous-day live timetable is intentionally withheld until the next successful Tokyo-date update.

## Decisions

- The browser reads only generated static JSON; Python adapters own all source-site access.
- Unknown or unverified formations remain `unknown` rather than receiving inferred seating.
- Failed data generation must leave the last valid JSON intact.
- Yulog mode refreshes and validates both `timetable.json` and `latest.json` before replacing either last-good snapshot.
- Search includes same-direction trains sharing at least one full segment with the selected corridor; a one-station touch is excluded.
- Intermediate-overlap times and formation are shown at the start of the shared segment, with no claim that a connection is feasible.

## Latest Session

- Date: 2026-08-26
- Goal: replace first-leg-inclusive search with route-overlap-inclusive search
- Changed: segment-level overlap matching, direct/first-leg/intermediate classification, overlap-segment display, catchability disclosure, formation-at-overlap lookup, localized copy, tests, and documentation
- Verification run: `npm run verify` passed with 13 Python tests, static-data validation, 22 frontend tests, production build, and preview smoke
- Artifacts: `.tmp/preview-smoke.log` contains the latest ignored local preview log
- Unverified: no external deployment was run; deployment requires user approval
- Next action: deploy after approval and verify the published overlap classifications plus `timetable.json.source.id=jr-central` and `isFixture=false`
