# #4718 visual-state investigation

This records the fourteen unexplained images from merged PR
[#4718](https://github.com/AaronBuxbaum/diveday/pull/4718), investigated on current main
`166445ea82aec7ae460c0d6b187f3ad2af1fbf4e`. It is evidence, not blanket visual approval.
No observed customer incident is claimed.

## Original comparison

- Actual: `5110cde802e8c9faf942f0f3bb8cf022254426c0`.
- Expected: `176b05d1da3e00af74bedeee0f540a116d6453c8`, the actual main baseline, with no fallback.
- [CI run 44229053712](https://github.com/AaronBuxbaum/diveday/actions/runs/44229053712),
  native GitHub artifact `14395311605` (`reg-suit-publish-bundle`).
- Preserved ZIP SHA-256: `bd82aa62507ecfa115f9af7b5be68713c102861d318d6e974f549a0aee6fdcad`.
- [Original visual summary](https://github.com/AaronBuxbaum/diveday/pull/4718#issuecomment-6966320959).
- Whole report: 42 changed, 2 new, 0 deleted, 2,170 passed. Of the images, 1,671 were freshly
  captured and 543 filled from baseline; filled images are not fresh rendered evidence.
- Original expected/actual/diff PNGs and the complete filename inventory were preserved locally.
  The native artifact is the upstream source; retention may expire it. No S3 fallback was used
  for this investigation.

Thirty changed/new images were already explained by personal-recap attribution/chart changes and
synthetic erasure-fixture cleanup. The following table accounts for the remaining fourteen exactly
once. `{390,1280}` means two separate viewport files.

## Fourteen-image inventory

| Capture, all `-light-vw-` unless stated | Images | Observation and conclusion |
| --- | ---: | --- |
| `manifest-at-sea-mid-roll-call…390.png` | 1 | Stale-roster warning absent; following content moves 20px. Capture awaited the saved offline copy, which does not prove a live roster. It now awaits a real trip/checkpoint-scoped 204 confirmation. No production warning is removed. |
| `manifest-plan-change…{390,1280}.png` | 2 | Recorder changes Keiko to Dana at the same timestamp. Fixture selected `crew[0]` from an unordered assignment query. A different database read plan reproduces the wrong actor. Explicit captain/name/id ordering fixes the fixture. |
| `schedule-builder-add-tide…{390,1280}.png`, `schedule-builder-move-blocked…{390,1280}.png` | 4 | The 3-trips/2-boats warning disappears; height falls 24px desktop or 40px phone. Both operational facts insert Trust I/II into the fleet. Schedule reset intentionally preserves boat configuration, so later captures in that worker can see four hulls. Real-database route regressions reproduce retained extra hulls before the fix. Facts now require private shops. Fleet calculations and reset semantics remain unchanged. |
| `sightings-custom-saved…390.png` | 1 | Stale-roster warning disappears; height falls 40px. Save completion alone does not establish current roster proof. Immediate-save assertions remain; a reload and real scoped confirmation establish the persisted online capture state. This fixes a capture gap; the historical response ordering was not recorded. |
| `staff-passkeys-empty…390.png` | 1 | Name/Add form becomes unsupported-browser copy. Initial `supported=false` renders that claim before measuring capability. Both language SSR regressions fail before the tri-state fix; supported and genuinely unsupported client cases pass afterward. Historical timing is not proved by the screenshot alone. Capture now positively requires the supported form. |
| `prep-assignments-need-care…{390,1280}.png` | 2 | Only selected By item shadow/border changes: 618 pixels each in a 78×51px box, 140 over 16 channel delta, maximum 42. Content and geometry are unchanged. SSR-raised option and measured sliding pill are distinct paint paths; capture now positively requires the measured pill. This is a stronger state contract, not proof of the historical raster cause or a justification to restyle the control. |
| `staff-navigation-spanish-enlarged-text-divers-es-ES…390.png` | 1 | Rail pose changes in x0–254/y742–820; whole Buceadores label and 390×3370 page remain. 4,646 pixels differ, 4,147 over 16 channel delta. Pose was set before whole-page paint; final-shot containment/cue assertions now cover the captured state too. No clipped-label product regression was demonstrated. |
| `sightings-autocomplete…390.png` | 1 | Actual 390×2277 exactly equals the entire baseline prefix. The baseline's final 20 rows are 7,800 background pixels, RGB(244,246,244). No text, image or control was lost. The historical document-extent trigger remains unmeasured; no crop, padding or threshold change is justified. |
| `product-es-ES…390.png` | 1 | Identical 390×6811 geometry/content. 648 of 2,656,290 pixels differ; mean affected channel delta about 1.05. Only three exceed 16, at rounded contours (25,6358), (364,6358), (27,6611); maximum 61. No actionable source regression demonstrated. Renderer cause unproved; no tolerance relaxed. |

The worker databases are isolated in `e2e/servers.ts`. The fleet failure is configuration leakage
between tests on one worker, not established cross-worker shared-database contention. This corrects
the earlier hypothesis in [#4703](https://github.com/AaronBuxbaum/diveday/issues/4703).

## Reproductions and boundaries

- `src/app/api/test/shop/route.test.ts`: both fleet facts inserted surviving boat IDs before
  restriction, then correctly return `not_available` on the canonical shop without changing its
  fleet after reset. Private-shop seeding remains covered.
- `src/test/shop-facts/put-a-boat-on-the-water.test.ts`: reverses name/UUID order and requests an
  alternative database read plan. Captain assignment is positively established; every after-dive
  mark must name that captain. Old unordered query fails, explicit ordering passes.
- `PasskeyPresentation.test.tsx`: bilingual SSR retains the empty section without a premature
  unsupported claim; genuine negative browser capability retains the password fallback.
- Local result: 91 focused tests across eight files, lint, typecheck, repository guards and
  production build passed. Playwright discovery found 145 tests in eight touched specs.
- Domain and security reviewers reported no confirmed/exploitable findings. Neither ran a browser.
- Prior local browser/server approval denial remains in force. Rendered verification is performed
  by exact-head CI; a local browser pass is not claimed.

Production readiness, roll-call semantics, fleet warnings, freshness proofs, reset retention and
passkey authorization/ceremonies are unchanged. No retries, wider timeouts, masks, safety assertion
reductions or comparison tolerance changes were added. The new PR requests `visual-all` so the
fourteen names are freshly captured rather than filled from baseline. Its exact-head results and
new visual verdicts belong in the PR's verification record.

Issue #4703 remains open for its separate crew-conflict spacing and settings-export sidebar cases;
this partial investigation does not close those cases or declare unknown raster causes solved.
