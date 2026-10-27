# Repository Agent Guide

## Project

Shizuoka Cross-Seat Radar is a static React site that helps passengers find cross-seat trains between Toyohashi and Atami. The primary journey is selecting two stations and a departure time, then reading upcoming trains, seat classification, formation, and freshness.

## Commands

| Purpose | Command |
| --- | --- |
| Bootstrap | `scripts/bootstrap.sh` |
| Start | `npm run dev` |
| Focused checks | `npm run check:fast` |
| Production smoke | `npm run smoke` |
| Full verification | `npm run verify` |

## Global Rules

- Work on one feature at a time; `feature_list.json` is the canonical feature state.
- Keep the product static: the browser may read `public/data/*.json` but must not call source websites.
- Treat Asia/Tokyo as the business timezone in Python, TypeScript, fixtures, and tests.
- Never present unverified formations as confirmed; preserve `unknown` and stale-data behavior. Archive-based predictions stay separately labeled and never change seat status or filters.
- Data generation must validate before atomic replacement and preserve the last good snapshot on failure.
- Do not weaken checks or mark work passing without evidence from the tested tree.
- Require user approval for deployment, destructive actions, or enabling an external data source.

## Read When Relevant

- Read `README.md` for architecture, data status, local use, and deployment.
- Read `scripts/data_sources/` before changing external adapters or normalization.
- Read `.github/workflows/` before changing data refresh or Pages behavior.
- Read `PROGRESS.md` for verified state, risks, and the next action.

## Operating Loop

1. Read `PROGRESS.md` and `feature_list.json`; inspect `git status` and the relevant code.
2. Run `scripts/bootstrap.sh`, then select at most one unblocked feature.
3. Iterate with `npm run check:fast`; use `npm run smoke` for user-visible or packaging changes.
4. Before completion, run `npm run verify`, inspect the diff, remove temporary artifacts, and update state evidence.

## Done

The requested behavior works, full verification passes, state files match the tested tree, affected documentation is current, and the next session can start without oral context.
