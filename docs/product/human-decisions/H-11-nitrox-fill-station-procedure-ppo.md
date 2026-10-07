# H-11: Which nitrox fill-station procedure, ppO₂ ceilings, mix band, O₂-clean tank tracking, and blender qualifications…

- **Status:** Implemented
- **Human owner:** Dive operations lead + gas-blending authority

## Decision or approval needed

Which nitrox fill-station procedure, ppO₂ ceilings, mix band, O₂-clean tank tracking, and blender qualifications apply?

## Minimum outcome to record

Approved ppO₂ limits, EANx band, per-agency card-acceptance rules — and, if a fill log of record is ever wanted here, a decision to build one (HD-8).

## Unblocks / follow-up

**Read this line first — what DiveDay actually holds (wording amended 2026-08-03, DOM-M4):** DiveDay gates the nitrox **fill request** and **holds no fill log**. What ships is a per-booking "wants enriched air" request, refused unless the shop's rental catalog offers nitrox, and re-checked live everywhere it matters (prep list, manifest, Today queue) against a **verified** nitrox specialty card — an unbacked request falls back to plain air rather than passing silently (`src/db/nitrox.ts`: `setBookingNitrox`, `authorizesNitroxFill`). There is **no fill record of any kind**: no analyzed mix %, no MOD figure, no ppO₂ ceiling, no analysis signature, no blender or tank identity, no per-fill row. **If the shop needs a fill log of record, DiveDay is not it — the shop's own log remains the record.** **Approved as-is 2026-07-30 (Aaron Buxbaum):** the [provisional dive parameters](README.md#nitrox-fills) — 22–40% O₂ mix band, MOD at ppO₂ 1.4 bar working / 1.6 bar contingency, fill authorized only against a verified nitrox specialty card — are accepted as the operating policy, not just a provisional default; of those, only the verified-card gate is a thing the product enforces, the band and the MOD basis being shop policy the product does not compute. Still gated on **V-05** (`dive-domain-expert` sign-off) before a real fill station operates; per-agency EANx card-acceptance nuances, O₂-clean tank tracking, and blender qualifications weren't separately itemized in this approval and can be revisited if V-05 surfaces a gap. **This amendment is a correction to the wording, not an answer to HD-8** — whether to build a minimal fill-analysis log is still open and still the owner's call. **Boundary settled 2026-09-02 (Aaron Buxbaum, #1234) — money, not gas:** a prepaid air-fill card is a commercial entitlement that may decrement a count of *paid* fills and nothing else. It may never carry a mix percentage, an analyzer reading, an MOD or ppO₂ figure, a blender, or a tank identity. That makes it a ledger rather than a fill log, so it does not reopen HD-8 — and a session proposing one does not need to ask this question again.

Part of the [human decision log](README.md#decision-register).
