# Shizuoka Cross-Seat Radar

A mobile-first static website for finding trains with transverse seating on the JR Tokaido Main Line between Toyohashi and Atami.

The current release combines JR Central's current-day individual-train timetable with the current formation assignments displayed by Tokaido Line Shizuoka Area Operation Information. Both are normalized server-side into checked-in static JSON; the browser never contacts either source.

## Features

- Departure station, destination station, and departure-time search across all 43 corridor stations
- JR Central-inspired orange-and-white passenger-information theme with a clear independent-service disclosure and no copied logo assets
- Direct trains sharing the selected corridor, plus first-leg and intermediate-overlap trains unless their overlap formation is confirmed as longitudinal-only
- Earliest-arrival complete scheduled itineraries for first-leg and intermediate-overlap results, constrained to use the displayed train
- Formation and seat category at the boarding station of every feeder, featured, and onward itinerary leg
- Result filters for direct longitudinal, direct unknown, indirect unknown, and minimum featured-train ride time
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
python3 -m scripts.update_data --source tokaido-shizuoka --operation-revision 202603
python3 -m scripts.validation
```

Generation validates the entire payload before atomically replacing an existing output. A failed update leaves the last successful JSON untouched.

## Deploy to GitHub Pages

1. Push this project to a GitHub repository whose default branch is `main`.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Deploy GitHub Pages** manually from the Actions tab.

The Vite build uses relative asset and data paths, so no repository name needs to be hardcoded. The deployment workflow runs Python tests, JSON validation, frontend tests, and `npm run build` before publishing `dist/`.

The data workflow runs every 30 minutes and on manual dispatch. Its default `FORMATION_SOURCE` is `fixture`, so it is idempotent and performs no source-site network request. When `FORMATION_SOURCE=tokaido-shizuoka`, the same validated update refreshes `timetable.json` from JR Central and `latest.json` from the Tokaido Shizuoka current-assignment JSON, joined through the configured `OPERATION_REVISION`. The legacy value `yulog` is accepted temporarily as a rollout alias but resolves to the Tokaido Shizuoka endpoint; the updater makes no direct Yulog request. If either source or validation fails, neither last-good snapshot is replaced. Valid changes are committed by `github-actions[bot]`. The Pages workflow also listens for successful completion of the updater because commits pushed with `GITHUB_TOKEN` do not trigger another push workflow.

## Data status

The checked-in `timetable.json` contains 43-station current-day services from JR Central and identifies itself with `source.id=jr-central` and `isFixture=false`. The checked-in `latest.json` identifies Tokaido Shizuoka with `source.id=tokaido-shizuoka` and `isMock=false`. A live timetable is used only on its matching Tokyo service date; an old snapshot is withheld until the updater publishes the new day.

Passenger services that cannot be joined to a published operating diagram remain visible with an unknown formation. Attach and detach stations split operation segments so the formation shown at boarding reflects the applicable part of the trip.

JR Central remains authoritative for every displayed station time. The operation tables contribute diagram IDs and formation metadata only, so a conflicting operation-table time never replaces the official timetable time.

A complete current assignment always takes precedence. If no current assignment exists for any diagram in a displayed segment, the site may fall back to an exact planned family only when the operation table uniquely identifies every diagram in that segment. The current operation assets support this for `U` (315 series) and `F` (373 series); mixed families such as `313(T/N/S)` are deliberately omitted. Partial or malformed current coverage stays unknown instead of mixing current and planned data. Planned results are visibly labeled and warn that substitutions may not be reflected. An unverified planned family may be named, but its seat classification and car counts remain unknown.

Search results are chronological by departure from the displayed overlap segment. Direct trains remain visible regardless of seating. A first-leg or intermediate-overlap train is shown only when its formation is not confirmed longitudinal-only and an end-to-end scheduled itinerary can include that train. Unknown formations remain eligible as possible cross-seat trains.

For every displayed indirect train, the browser computes the earliest-arrival itinerary from the selected origin and time to the selected destination that boards that train at the card's displayed overlap start. Complete routes rank by earliest destination arrival, then latest origin departure, then fewer transfers, then less transfer waiting. This avoids choosing an unnecessarily early feeder when a later train catches the same featured service. The planner may use feeder and onward trains or transfer before the featured train's terminal when that arrives sooner. Feeder and onward route profiles are calculated once per query and reused across matching trains, while formation-filtered candidates are omitted before journey planning. Connections are accepted when the next scheduled departure is at or after arrival. Platform walking time, delays, and guaranteed connections are not available and are explicitly excluded from the calculation.

Every itinerary leg is classified independently using the formation at that leg's boarding station. The result controls can hide confirmed longitudinal direct trains, unknown direct trains, or unknown indirect trains. A fourth optional control requires a user-entered minimum number of scheduled minutes aboard the featured indirect train; waiting and time aboard its feeder or onward trains do not count. The three visibility controls default on and the duration requirement defaults off.

Verified formation metadata currently classifies K/L/S as convertible cross seating, V as semi/box cross seating, and W/T/N/U as longitudinal. Unrecognized families, including F in this MVP, stay unknown.

## Real source adapters

The real-data mode uses four read-only feeds and is not enabled by default:

- **Tokaido Line Shizuoka Area Operation Information, current assignments**: the site's operation pages load dated `diagram → formation` data with `GET https://tokaido-unyo-shizuoka.com/json/unyo/unyo-data-current.json`. The adapter normalizes assignments and change expressions such as `W5/W8→U1`.
- **Tokaido Line Shizuoka Area Operation Information, operation tables**: versioned 2026 CSV assets map operating diagrams to train numbers, service-day rules, partner diagrams, and attach/detach markers.
- **JR Central conventional-line train information**: the official individual-train JSON supplies current-day train numbers, destinations, station calls, and scheduled times.
- **Cabinet Office national-holiday CSV**: the official calendar selects the correct weekday, Saturday, holiday, and special-day operation rows.

No POST/reporting request is used. Adapter tests use local samples and never contact source sites.

The Tokaido Shizuoka pages state that their current-assignment display uses Yulog-provided data with permission. The site does not publish an explicit machine-data reuse license, and its permission to display upstream data does not necessarily grant downstream republication rights. Before enabling real mode, confirm permission, attribution, and acceptable request frequency with the site maintainer and, for the mirrored assignments, the original provider. Then set the repository Actions variable `FORMATION_SOURCE` to `tokaido-shizuoka` and keep `OPERATION_REVISION` aligned with the published timetable revision. Keep the visible source attribution and conservative stale/unknown behavior.

Fixture mode remains available for offline development. It marks both snapshots as mocked, and the UI restores the demonstration warning automatically.

## Agent harness

`AGENTS.md` is the short operating contract. `feature_list.json` is the canonical feature state, and `PROGRESS.md` records verified evidence, risks, and the next action. A fresh session should read those files, run `scripts/bootstrap.sh`, work on at most one active feature, and finish with `npm run verify` plus updated evidence.

The visual theme takes its color direction from JR Central's published description of orange and white as its long-established corporate colors. The interface uses those colors as an independent visual reference; it does not reproduce the JR Central logo or claim official affiliation.

## Source references

- [JR Central 315 series design and corporate-color description](https://railway.jr-central.co.jp/315s/)
- [Yulog – Shizuoka Operation Status (upstream provenance; not called directly)](https://yulog.app/unyo/)
- [Tokaido Line Shizuoka Area Operation Information, March 2026](https://tokaido-unyo-shizuoka.com/unyo/202603/)
- [JR Central conventional-line train information](https://traininfo.jr-central.co.jp/zairaisen/train_information.html?line=10001)
- [Cabinet Office national holidays](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html)
