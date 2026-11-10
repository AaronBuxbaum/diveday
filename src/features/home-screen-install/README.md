# Home-screen install entry

Device-only support and dismissal for the staff Logbook’s quiet install row
(ADR 20260907-in-your-hands, slice 19e). The public surface is `index.ts`; `rules.ts` contains
browser classification and the guarded local preference, with no server reads or writes.

- Known iOS browsers use Safari instructions; only Android Chrome gets manual Chrome instructions.
- Other Android browsers need an actual deferred install event, handled by the client component.
- Desktops, known in-app browsers and unrecognized devices have no supported instruction path.
- The component additionally refuses frames and installed display modes, and keeps operational work first.
- A failed preference read suppresses the row. A failed write still holds dismissal in memory for
  this document. Installation is never evidence that an offline manifest is saved or fresh.

Tests: `rules.test.ts` pins classification and storage failures; `src/app/shop/[shopSlug]/_components/today/HomeScreenInstall.test.tsx` pins
prompt lifecycle and suppression; `src/app/shop/[shopSlug]/_components/today/HomeScreenInstallSlot.test.tsx` pins the manifest’s all-staff gate.
Browser and capture coverage is in `e2e/home-screen-install.spec.ts` and
`e2e/visual-home-screen-install.spec.ts`.
