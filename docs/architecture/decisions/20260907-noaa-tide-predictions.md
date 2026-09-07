# 20260907-noaa-tide-predictions — Read the tide window from NOAA CO-OPS predictions

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

Florida diving is planned around the tide, and the app knew nothing about it: the marine outlook
(Open-Meteo, `src/lib/marine-forecast.ts`) says what the surface is doing and the site briefing
carries the shop's own `current_note`, but nothing said whether a departure reaches its site at
the turn or in the middle of the ebb. N-01 of the 2026-09-07 improvement-ideas sheet asked for one
sentence — "Slack at 09:40; this departure reaches the site on the flood" — on the staff site
briefing, the board's add panel and the departure page, and on the diver's page when the shop
chooses (owner decision 2026-09-07, improvement-ideas decision sheet).

Two constraints shape the choice. A new external service is a hard-to-reverse dependency (this
record). And the sentence names a clock time and a direction beside a Book button, so it must
either be right or absent — never a guess, and never a gate: readiness and admission do not read it.

## Decision

**NOAA CO-OPS is the one provider**, reached through one endpoint: `api.tidesandcurrents.noaa.gov`'s
`predictions` product at `hilo` interval, metric, MLLW, GMT. No key, no account, no cost, and the
high/low table is exactly what a tide chart prints. A dive site carries an optional seven-digit
station id and a "best on" preference (`any` / `slack` / `flood` / `ebb`); a shop picks the nearest
ocean-side station from NOAA's own list, since a reef is rarely a station itself (the demo's Key
Largo sites read Carysfort Reef, 8723583).

**The seam is `marine-forecast.ts`'s seam**, in `src/lib/tide-predictions.ts`: injectable fetcher,
four-second bound, `DIVEDAY_DISABLE_EXTERNAL_HTTP` honoured, every failure answering `null`. The
math is pure and separate (`src/lib/tides.ts`): slack is the half hour either side of a predicted
turn, flood runs from a low to the next high, ebb the reverse, and the arrival instant is the
dock-day rhythm's own `dockDayOffsets` — the same arithmetic the diver's "Dive 2 · 10:40 AM" beat
uses, so the tide is read where the boat actually is. Predictions are cached per station and local
day, promise included, so concurrent renders share one request.

**With external HTTP disabled the seam serves a fixture rather than nothing.** A deterministic
semidiurnal table derived from the date, so the e2e fleet and an offline dev server render the
sentence stably under the frozen clock. The flag is set only by `scripts/dev-server.mjs` and
`playwright.config.ts`; production never sees the fixture.

**The diver's page is opt-in** (`shops.tide_window_public`, default off). Staff surfaces read the
window whenever a site has a station.

## Alternatives considered

- **Compute tides locally from harmonic constituents** — no dependency, but the constituents are
  NOAA's data anyway, subordinate stations (most reef stations) are published only as offsets, and
  a wrong local computation is exactly the failure this must not have.
- **Open-Meteo's marine API** — already a dependency, but it publishes sea level height rather than
  a high/low table, and no US-coast station offsets.
- **Return `null` under the disabled-HTTP flag, as the forecast does** — leaves the sentence with no
  visual baseline and the dev server with nothing to look at; the fixture is the smaller cost.
- **Show the line to divers by default** — a clock time beside a Book button reads as a promise the
  crew have not made; whether to publish it is the shop's call.

## Consequences

Easy: one more sentence on four surfaces, worded once per bundle (`src/i18n/tide-labels.ts`);
adding a station to a site is one field. Hard: NOAA's slack is the tide table's turn, not a current
measurement — real slack on a reef lags it by an amount that depends on the site, and the shop's
`current_note` remains the place to say so. Committed to: NOAA's endpoint shape (a rename there
costs a parser change and nothing else) and the seven-digit id format.

Escape hatch: the provider lives behind `fetchTidePredictions`'s one signature, so a second source
is a new module and a switch, not a data migration; dropping the feature is two columns and one
shop flag (H-49, pre-pilot).
