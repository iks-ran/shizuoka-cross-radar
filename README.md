# Shizuoka Cross-Seat Radar

A mobile-first static website for finding trains with transverse seating on the JR Tokaido Main Line between Toyohashi and Atami.

The current release is a working fixture-data MVP. It intentionally displays a persistent demonstration warning and must not be used as live passenger information.

## Features

- Departure station, destination station, and departure-time search across all 43 corridor stations
- Direct trains and useful first-leg trains that terminate before the selected destination
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

Install and start the development server:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

Run all acceptance checks:

```bash
python3 -m unittest discover -s tests -p "test_*.py"
python3 -m scripts.validation
npm test
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Regenerate fixture data

The fixture timetable is generated from a compact source file:

```bash
python3 -m scripts.generate_fixture_timetable
python3 -m scripts.update_data --source fixture
python3 -m scripts.validation
```

Generation validates the entire payload before atomically replacing an existing output. A failed update leaves the last successful JSON untouched.

## Deploy to GitHub Pages

1. Push this project to a GitHub repository whose default branch is `main`.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Deploy GitHub Pages** manually from the Actions tab.

The Vite build uses relative asset and data paths, so no repository name needs to be hardcoded. The deployment workflow runs Python tests, JSON validation, frontend tests, and `npm run build` before publishing `dist/`.

The data workflow runs every 30 minutes and on manual dispatch. Its default `FORMATION_SOURCE` is `fixture`, so it is idempotent and performs no source-site network request. If a valid generated snapshot changes, it is committed by `github-actions[bot]`. The Pages workflow also listens for successful completion of the updater because commits pushed with `GITHUB_TOKEN` do not trigger another push workflow.

## Data status

Still mocked:

- All station-by-station timetable times
- Train identifiers and operating-diagram assignments in the fixture timetable
- The deployed current-day formation snapshot

Verified formation metadata currently classifies K/L/S as convertible cross seating, V as semi/box cross seating, and W/T/N/U as longitudinal. Unrecognized families, including F in this MVP, stay unknown.

## Real source adapters

Two read-only adapters are included but are not enabled by default:

- **Yulog – Shizuoka Operation Status**: the page loads current diagram assignments with `GET https://api.yulog.app/unyo/read/sz`. The adapter normalizes dated `diagram → formation` reports and change expressions such as `W5/W8→U1`.
- **Tokaido Line Shizuoka Area Operation Information**: versioned 2026 CSV assets map operating diagrams to train numbers, service-day rules, partner diagrams, and attach/detach markers.

No POST/reporting request is used. Adapter tests use local samples and never contact either site.

Neither source currently publishes an explicit machine-data reuse license. Before enabling Yulog, contact the maintainers to confirm permission, attribution, and acceptable request frequency. After permission, set the repository Actions variable `FORMATION_SOURCE` to `yulog`. Keep the visible source attribution and conservative stale/unknown behavior.

The recommended next integration step is to obtain a reliable, permissioned station-by-station timetable feed and then normalize operation segments—especially trains that attach or detach en route—before removing the demonstration warning. The user's browser must continue reading only the generated static JSON.

## Source references

- [Yulog – Shizuoka Operation Status](https://yulog.app/unyo/)
- [Tokaido Line Shizuoka Area Operation Information, March 2026](https://tokaido-unyo-shizuoka.com/unyo/202603/)
- [JR Central station/timetable reference](https://railway.jr-central.co.jp/time-schedule/srch/_pdf/data/202503/tokaido_Hamamatsu_B_wh_u.pdf)
