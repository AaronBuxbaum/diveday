# 20260907-noaa-tide-predictions — Read the tide window from NOAA CO-OPS predictions

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

Florida diving is planned around the tide, and the app knew nothing about it: the marine outlook
(Open-Meteo, `src/lib/marine-forecast.ts`) says what the surface is doing and the site briefing
carries the shop's own `current_note`, but nothing said whether a departure reaches its site at
the turn or in the middle of the ebb. N-01 of the 2026-09-07 improvement-ideas sheet asked for one
sentence — "Next high water at 09:40; this departure reaches the site on the flood" — on the staff site
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

**One line per site for a diver, one per leg for the crew.** A two-tank day on one wreck would
otherwise show a diver the same sentence twice with a different clock time and nothing saying which
dive is which; the crew's own departure page keeps every leg, prefixed by the site. And the site
briefing's "Upcoming dives here" list has no end — a daily reef trip materializes a departure a day
out to the series horizon — so only the soonest seven rows carry a line, fetched concurrently. The
rest read exactly as they did before this feature.

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

## Amendment 2026-09-07 — the sentence names a height turn, because that is what we fetched

The first cut of the wording opened with **"Slack at {time}"** over a turn taken from
`predictions` at `hilo` interval. That endpoint publishes **water level**. Slack water is a
property of the *current*, NOAA publishes it separately in `currents_predictions`, and the two
are not interchangeable: checked against one real pair on 2026-07-21, station ACT8216 (Caesar
Creek) reports slack at 02:15, 07:21 and 15:05 while the nearest water-level station, Virginia Key
8723214, reports its turns at 00:48, 06:52 and 13:18. Slack lagged the height table by 87, 29 and
107 minutes at one station on one day. The half hour either side of a turn catches one of those
three and misses two.

The Consequences above already said this in the abstract, and the sentence asserted it anyway. A
captain reading "Slack at 9:19 AM" before a Spiegel Grove descent is being told something the data
does not contain, on the surface that exists to give them that number — which is the case this
record's own Context rules out: the sentence "must either be right or absent".

The prefix now names what was fetched, and which side of the arrival it sits on: **"Next high
water at 1:19 PM"**, **"Last low water at 6:45 AM"**. The second half of that is a separate defect
the same review found — `nearestTurn` is nearest by absolute distance, so on most arrivals it is
the turn already behind the boat, and `minutesToTurn` carried the sign with nothing reading it.
The phase clause says **"at the turn of the tide"** rather than "at slack water" for the same
reason.

What did **not** change: `flood` and `ebb`, which are ordinary descriptions of the stream inferred
from a height curve and are how tide-table dive planning has always worked; and the *shop's* own
preference clause, where "It dives best at slack water" is the shop speaking about its own reef
rather than DiveDay speaking about NOAA's data. The internal phase code stays `slack` — it names
the half hour around a turn, which is what it has always computed.

Pinned by `src/i18n/tide-labels.test.ts`, which fails on a sentence that opens with "Slack at" or
its Spanish twin "Estoa a las".

## Amendment 2026-09-10 — a second endpoint, for confirmation only

The Decision above says NOAA CO-OPS is reached "through one endpoint". It is now reached through
two, and the provider is still one.

The rule that a station id is seven digits (`isTideStationId`) was the whole of its validation, and
it cannot be more: a subordinate station's id looks exactly like a harmonic one's, every seven-digit
id answers the predictions endpoint, and nothing on the dive-site form ever said what those digits
named. A shop that typed the station for the wrong end of the Keys therefore got a confident tide
sentence about the wrong water on every departure, with nothing anywhere saying so — issue #1468.
This record's own Context rules that out: the sentence "must either be right or absent".

So `mdapi/prod/webapi/stations/<id>.json` is read for the station's **own name and position**, in
`src/lib/tide-stations.ts`, behind the same seam shape as `tide-predictions.ts`: injectable fetcher,
four-second bound, `DIVEDAY_DISABLE_EXTERNAL_HTTP` honoured with a deterministic fixture for the
e2e fleet and an offline dev server, every failure answering `null`. Its own cache, keyed on the id
alone and living a day rather than half of one, because a station's name and position do not depend
on the day.

Two things come off it, both on the dive-site editor and nowhere else. The station's name is
**echoed back** under the id, so a wrong id is legible as a wrong *place* rather than as seven
digits nobody can check. And when the station sits further than `IMPLAUSIBLE_STATION_DISTANCE_KM`
(40 km) from the site's own coordinates, one sentence says so. Forty is calibrated on the mistake
the demo's own seed comment names — a Key Largo reef reading Vaca Key at Marathon, eighty
kilometres down the chain — against a genuinely nearest ocean-side station, normally inside
twenty-five; the demo's correct Carysfort pairing is twenty-nine.

**It authorizes and blocks nothing.** The lookup lives in the page's render, not in `saveAction`,
which is what makes "a failed lookup never blocks a save" structural rather than careful: the save
writes the id and redirects, and the echo appears on the render that follows. A site with no
coordinates gets no distance sentence at all — a site that has not said where it is cannot
contradict anything — and the flag is a prompt to look, never a refusal. There is still no station
picker: choosing one is a question NOAA's own list answers better than a dropdown could.

What is committed to: one more endpoint shape from the same provider. The escape hatch is
unchanged — a rename there costs a parser change, and dropping the confirmation is one module, one
prop and three bundle keys.
