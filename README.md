# Shizuoka Cross-Seat Radar

A mobile-first static website for finding trains with transverse seating on the JR Tokaido Main Line between Toyohashi and Atami.

The current release combines JR Central's current-day individual-train timetable with Yulog's current formation assignments. Both are normalized server-side into checked-in static JSON; the browser never contacts either source.

## Features

- Departure station, destination station, and departure-time search across all 43 corridor stations
- Direct, first-leg, and intermediate-overlap trains sharing at least one segment of the selected corridor
- Formation-at-boarding display and conservative cross-seat classification
- Japanese, English, and Simplified Chinese UI
- Asia/Tokyo date, time, and freshness logic
- Static JSON data with no browser-side requests to source websites
- Atomic Python generation that preserves the last good snapshot on failure
- GitHub Actions workflows for periodic data updates and GitHub Pages deployment

## Project structure

```text
src/                         React UI, localization, and domain logic
public/data/                 Generated static JSON consumed by the browser
data/corridor.json           Static corridor station IDs and localized names
data/fixtures/               Fixture source data and offline adapter samples
scripts/                     Python adapters, generators, and validators
tests/                       Python unit tests
.github/workflows/           Data update and Pages deployment workflows
```

The browser reads only:

- `public/data/timetable.json`
- `public/data/formations.json`
- `public/data/latest.json`

`timetable.json` contains station calls and optional operating-diagram segments. `latest.json` maps operating diagrams to current units, and `formations.json` describes the seating layout of each verified formation family.

## Run locally

Requirements:

- Node.js 24 or a compatible current release
- Python 3.10+

Bootstrap the locked dependencies and verify the local baseline:

```bash
scripts/bootstrap.sh
```

Start the development server:

```bash
npm run dev
```

Open the local URL printed by Vite.

Run the fast feedback loop:

```bash
npm run check:fast
```

Run full acceptance, including a production-preview smoke test:

```bash
npm run verify
```

Preview the production build:

```bash
npm run preview
```

## Regenerate data

Generate the fully offline fixture pair:

```bash
python3 -m scripts.update_data --source fixture
python3 -m scripts.validation
```

After source permission and request frequency have been approved, generate the real pair:

```bash
python3 -m scripts.update_data --source yulog --operation-revision 202603
python3 -m scripts.validation
```

Generation validates the entire payload before atomically replacing an existing output. A failed update leaves the last successful JSON untouched.

## Deploy to GitHub Pages

1. Push this project to a GitHub repository whose default branch is `main`.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Deploy GitHub Pages** manually from the Actions tab.

The Vite build uses relative asset and data paths, so no repository name needs to be hardcoded. The deployment workflow runs Python tests, JSON validation, frontend tests, and `npm run build` before publishing `dist/`.

The data workflow runs every 30 minutes and on manual dispatch. Its default `FORMATION_SOURCE` is `fixture`, so it is idempotent and performs no source-site network request. When `FORMATION_SOURCE=yulog`, the same validated update refreshes `timetable.json` from JR Central and `latest.json` from Yulog, joined through the configured `OPERATION_REVISION`. If either source or validation fails, neither last-good snapshot is replaced. Valid changes are committed by `github-actions[bot]`. The Pages workflow also listens for successful completion of the updater because commits pushed with `GITHUB_TOKEN` do not trigger another push workflow.

## Data status

The checked-in `timetable.json` contains 43-station current-day services from JR Central and identifies itself with `source.id=jr-central` and `isFixture=false`. The checked-in `latest.json` identifies Yulog with `source.id=yulog` and `isMock=false`. A live timetable is used only on its matching Tokyo service date; an old snapshot is withheld until the updater publishes the new day.

Passenger services that cannot be joined to a published operating diagram remain visible with an unknown formation. Attach and detach stations split operation segments so the formation shown at boarding reflects the applicable part of the trip.

Search results are chronological by departure from the displayed overlap segment. Intermediate-overlap results show the actual shared segment, but the site does not calculate whether the passenger can reach that train or make any onward connection.

Verified formation metadata currently classifies K/L/S as convertible cross seating, V as semi/box cross seating, and W/T/N/U as longitudinal. Unrecognized families, including F in this MVP, stay unknown.

## Real source adapters

The real-data mode uses four read-only sources and is not enabled by default:

- **Yulog – Shizuoka Operation Status**: the page loads current diagram assignments with `GET https://api.yulog.app/unyo/read/sz`. The adapter normalizes dated `diagram → formation` reports and change expressions such as `W5/W8→U1`.
- **Tokaido Line Shizuoka Area Operation Information**: versioned 2026 CSV assets map operating diagrams to train numbers, service-day rules, partner diagrams, and attach/detach markers.
- **JR Central conventional-line train information**: the official individual-train JSON supplies current-day train numbers, destinations, station calls, and scheduled times.
- **Cabinet Office national-holiday CSV**: the official calendar selects the correct weekday, Saturday, holiday, and special-day operation rows.

No POST/reporting request is used. Adapter tests use local samples and never contact source sites.

The two community sources do not currently publish an explicit machine-data reuse license. Before enabling real mode, contact their maintainers to confirm permission, attribution, and acceptable request frequency. Then set the repository Actions variable `FORMATION_SOURCE` to `yulog` and keep `OPERATION_REVISION` aligned with the published timetable revision. Keep the visible source attribution and conservative stale/unknown behavior.

Fixture mode remains available for offline development. It marks both snapshots as mocked, and the UI restores the demonstration warning automatically.

## Agent harness

`AGENTS.md` is the short operating contract. `feature_list.json` is the canonical feature state, and `PROGRESS.md` records verified evidence, risks, and the next action. A fresh session should read those files, run `scripts/bootstrap.sh`, work on at most one active feature, and finish with `npm run verify` plus updated evidence.

## Source references

- [Yulog – Shizuoka Operation Status](https://yulog.app/unyo/)
- [Tokaido Line Shizuoka Area Operation Information, March 2026](https://tokaido-unyo-shizuoka.com/unyo/202603/)
- [JR Central conventional-line train information](https://traininfo.jr-central.co.jp/zairaisen/train_information.html?line=10001)
- [Cabinet Office national holidays](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html)
