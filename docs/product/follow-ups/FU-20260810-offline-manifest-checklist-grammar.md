# FU-20260810-offline-manifest-checklist-grammar — Bring the offline roll call onto the live manifest's checklist grammar

- **Status:** Open
- **Raised:** 2026-08-10 — the manifest-page simplification on `claude/app-design-overhaul-nx3437`
- **Kind:** improvement
- **Effort:** M
- **Touches:** `src/components/OfflineManifestView.tsx`, `src/components/MissingDiversGrid.tsx`, `src/app/offline-manifest/`

## What I noticed

The live manifest page was reshaped into a checklist: diver rows collapse their emergency
contact / rental fit / medical lines behind a per-row "Contact & gear" disclosure, the
"Mark not boarded" control is ghost-weight until it is recorded or is the row's only control,
and the "Still to board" face grid was replaced by name chips under the checkpoint panel
(`src/app/shop/[shopSlug]/trips/[id]/manifest/_components/`). The offline roll call
(`src/components/OfflineManifestView.tsx`) still renders the old grammar — full facts on every
row, two equal-weight buttons, and the `MissingDiversGrid` section. A captain who works the
live page at the dock and the offline page underway now reads two different layouts for the
same job.

## Why it isn't already done

Outside the scope of the live-page redesign, and the offline view has its own constraints worth
their own review: it renders from a serialized snapshot (`src/lib/offline-manifests.ts`), it is
the surface used with *no* signal where a mis-tap is harder to notice, and its tests
(`src/components/OfflineManifestView.test.tsx`, `e2e/manifest.spec.ts` offline halves) pin a lot
of its wording. Restyling it deserves a session that owns those trade-offs rather than a drive-by.

## Proposed change

Mirror the live page's row shape in `OfflineManifestView`: facts behind the same "Contact & gear"
disclosure (the serialized payload already carries them), ghost-weight exception control via the
same visual rules as `RollCallControls`, and decide whether the face grid earns its keep there
(offline has no sticky summary panel, so the grid may still be the right jump surface — if it
stays, say why in the component). Do *not* change the offline data model, the reconcile flow, or
any recorded-state wording (DOM-H3).

## Prompt

```text
Read docs/design/principles.md, then src/app/shop/[shopSlug]/trips/[id]/manifest/_components/DiverRollCall.tsx
and RollCallControls.tsx (the live manifest's checklist grammar), then src/components/OfflineManifestView.tsx.
Bring the offline roll call's rows onto the same grammar: reference facts (emergency contact,
rental fit, medical) behind a per-row disclosure, the unrecorded "not boarded"/"not back aboard"
control at ghost weight under the primary (keep full weight when recorded or when it is the only
control), keeping every recorded-state word and the reconcile flow exactly as they are (DOM-H3 —
after a dive the exception control means "did not come back" and never wears a done-check).
Decide explicitly whether MissingDiversGrid stays on the offline view (it has no sticky summary
panel, so the grid may remain the right "who's left" surface) and record the decision in a
comment. Update src/components/OfflineManifestView.test.tsx and the offline halves of
e2e/manifest.spec.ts. Verify with pnpm test src/components/OfflineManifestView.test.tsx
--reporter=dot, pnpm e2e:run manifest.spec.ts --reporter=line, screenshots of /offline-manifest
light+dark, and pnpm check. Delete docs/product/follow-ups/FU-20260810-offline-manifest-checklist-grammar.md
as part of the change.
```
