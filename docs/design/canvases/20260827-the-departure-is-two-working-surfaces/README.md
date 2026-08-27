# The departure is two working surfaces — canvas

- **Status:** Live (its ADR is Proposed — this canvas may still be edited)
- **Date:** 2026-08-27
- **ADR:** [20260827-the-departure-is-two-working-surfaces](../../../architecture/decisions/20260827-the-departure-is-two-working-surfaces.md)
- **Published:** https://claude.ai/code/artifact/17ad2d81-4c8a-45fe-8cf3-c0d972469bd4

The first design canvas in this repo. Read
[design-artifacts.md](../../design-artifacts.md) before editing it, adding another, or treating
anything here as normative — **it is not**. The ADR carries the decisions; these are the pictures
drawn to argue them.

## Artboards

**Page 1 — Surfaces** (the redesigned surfaces at rest)

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The Trip page at desktop width: masthead, the one-line About strip, and the roster as one grouped ledger |
| `Trip.dc.html` | The same page with the About panel open — everything the old Overview tab held, as label/value rows |
| `Manifest.dc.html` | The manifest at desktop width: the count instrument, buddy-team clusters, roll call, crew |
| `TripPhone.dc.html` | The Trip page on a 390px phone, with the staff dock |
| `ManifestPhone.dc.html` | The manifest at the rail: full-screen, no dock, 56px taps, boat-mode ink |
| `System.dc.html` | The design language: the three-tier boat rule, row anatomy, roll-call states, type, colour, and what moved where |

**Page 2 — The boat flow** (the day, in sequence)

| File | What it shows |
| --- | --- |
| `FlowMap.dc.html` | The five stages dock to dock, the invariants every beat keeps, and the edge cases the flow absorbs |
| `DockComplete.dc.html` | Beat 1 — the dock count closes; one diver stayed ashore |
| `IntervalCount.dc.html` | Beat 2 — counting divers back after dive 1, calm: an open circle means "not yet" |
| `NotBack.dc.html` | Beat 3 — the crew records one diver not back; the alarm is earned and pins |
| `PersonSheet.dc.html` | Beat 4 — her sheet: today's trail, buddy states, contact as reference, one act |
| `AllBack.dc.html` | Beat 5 — she is back aboard; the checkpoint closes and the next one is offered |

`canvas.json` places them on the two pages and sets the launch view.

## The fiction every board holds to

One departure: **Sunrise Two-Tank — Molasses Reef**, Fri Sep 11, 7:00–10:30 AM, boat *Mantis II*,
$95 a seat, 12 seats, 10 booked, 2 waiting. Seven divers ready; three blocked at the desk (Amara
Osei and Felix Grant have no certification on file, Mateo Duarte's is awaiting verification). At the
dock all three clear and sail; Georg Fischer oversleeps and stays ashore, carried forward dimmed at
every later checkpoint and outside its denominator. Crew: Keiko Tanaka (divemaster) and Sal Moretti
(captain). Eleven souls sail. After dive 1, Meera Iyer is late up the ladder and is recorded not
back at 8:29, then back aboard at 8:33.

Every name, number and time here is demo-seed fiction. Nothing in this directory is real customer
data, and nothing in a future canvas may be either.

## Working on it

These are plain HTML files with inline styles: open one in a browser to see that board on its own.
To rebuild the published canvas from them, use the `/design` skill's helper — seed the artboards
plus `canvas.json` into a fresh payload, `--check` it, and publish to the **same URL** above so the
link in the ADR keeps working.
