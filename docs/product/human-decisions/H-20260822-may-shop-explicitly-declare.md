# H-20260822-may-shop-explicitly-declare: May a shop explicitly declare a waiver edit non-material, so the display version advances…

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

May a shop explicitly declare a waiver edit non-material, so the display version advances while existing signatures remain current?

## Minimum outcome to record

Human choice recorded with the published version, actor, timestamp, and whether the edit was material; never infer materiality from a diff.

## Unblocks / follow-up

**Decided yes 2026-08-22 (Aaron Buxbaum):** every version still increments, a material edit advances `material_generation`, and a non-material correction keeps that generation. The waiver editor presents two explicit choices when standing signatures exist; `waiver_materiality_decisions` records who chose and when. Existing signatures compare generations, not display versions. Legal sufficiency remains under H-20260730-jurisdiction-waiver-text-medical, H-20260730-evidence-retention-period-deletion, H-20260724-current-typed-name-explicit.

Part of the [human decision log](README.md#decision-register).
