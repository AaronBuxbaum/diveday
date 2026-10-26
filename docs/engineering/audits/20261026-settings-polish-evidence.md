# Auth and settings polish evidence

Issue #3070, base `9af4a72c80221f7bd5b9470f2a14fac3c9e6e9cb`, branch
`codex/visual-polish-04-settings`. This records the intended matrix before implementation;
an entry in this table is not a claim that the state has been exercised.

| ID | Routes | Required changed states |
| --- | --- | --- |
| M07 | `/sign-in`, `/forgot-password`, reset comparison | Initial, wrong credentials, ended session, shop escape, reset sent/error/success |
| M08 | `/onboard`, `/get-set-up` | Uninvited/consumed/invalid redirects, authorized form, validation, submitted |
| RP05 | `/sign-in` | Neutral challenge, incorrect code, recovery code, rate limit, Back, focused code field |
| C03 | Settings import | Upload, full reference open, malformed/duplicate, preview, commit/refusal, other tabs |
| C05 | Settings security | One/many/same-browser/missing-UA devices, current markers, revoke success/failure, reauthentication |
| C07 | Settings embed and real host iframe | Calendar/Button, More formats, every preserved kind, selector reset, code parity, empty/loading/success |
| C08 | Settings export/backups | Unconfigured, never delivered, success, newer failure, old success, history page 2, destination edit/refusal |
| C09 | Settings email | Each preference on/off/pending/error, keyboard switch, preview, no send |
| C11 | Settings activity | Multiple local days, long names, empty/filtered-empty, Filter open, active range, pagination |
| C12 | Settings calendar | Empty/issued/existing/rotated/revoked/denied, copy failure, crew-only scope |
| RGS02 | Staff search palette | Empty/populated/pending/failed, Close/Escape/backdrop, focus return, coarse pointer, virtual keyboard |
| RGS04 | Settings export | Outer closed/open, all files/counts/zero rows, long full note, exclusions, no search |
| RGS09 | Settings card-check diagnostics | Sample pass/failure/no-answer, report closed/open, copy equality/failure, no extension/PADI off |

Common evidence: complete before/after light pages at 390 and 1280; 768 when controls change;
long Spanish and 200% zoom; keyboard/focus/return, touch targets and reduced motion.
Color changes also need dark. Review native tiles and pixel-probe flags. Tests remain focused;
CI owns whole suites/build/visual comparison. Root owns capture resource windows and publication.

C05 baseline: current `AccountSessionsList.tsx` groups by device, displays current-device and
last-seen facts, and discloses per-session revoke actions. The portable audit records no existing
security/session capture establishing a residual visual defect. Leave its implementation unchanged
until fresh runtime evidence demonstrates one; source inspection alone is not closure evidence.

RP05 boundary: this layer distinguishes normal challenge and invalid-code presentation while
retaining the current credentials endpoint. Avoiding credential re-entry through a new pending
challenge/session concept was approved as separate issue #3078. It is not part of this presentation change. Never persist passwords or
include credentials in URLs, hidden fields, storage, screenshots or diagnostic reports.

V06/V07/V08 and contributing V01 remain bounded by the issue's matrix. Real provider delivery,
third-party CMS behavior and physical-device accessibility must be reported separately from local
fixtures and browser emulation. No customer messages or live financial activity are authorized.

Verification and review results will be recorded after they are observed.

## Observed local evidence

- Initial focused regressions failed for indistinguishable required/invalid second-factor
  outcomes and the missing palette Close control. After the fixes, 9 focused UI files passed
  113 tests; 8 focused server/module files passed 58 tests. These runs preceded the final visual
  refinements and are not a claim that the final diff has completed every gate.
- Typecheck passed before the final review fixes. Locale, copy and E2E hygiene checks passed.
  Voice passed after correcting the American spelling of “acknowledgments”.
- Root's fresh C05 runtime captures at 390/1280 showed Chrome/macOS grouping and the current-device
  marker with 10 sessions. Revoking an older noncurrent local demo session left 9 sessions after
  reload. No C05 implementation change is justified. Single-session, unknown-user-agent,
  reauthentication and revocation-failure combinations are not established by this runtime pass.
  Local evidence: `/tmp/polish-04-settings/sessions-expanded-native-390.png` and
  `/tmp/polish-04-settings/sessions-revoked-native-390.png`, plus default phone/desktop captures.
- Root exercised RGS02 at 390 with an empty result: Close removed the dialog and restored focus
  to Search. Local evidence: `/tmp/polish-04-settings/palette-open-native-390.png` and
  `/tmp/polish-04-settings/palette-empty-native-390.png`. A physical virtual keyboard was not
  exercised.
- First design review identified inline second-factor helper text and email switches falling
  below section descriptions. The fixes use a 16px standalone code label with separately
  described helper text, and a local heading/switch grid above full-width email descriptions.
  Root also reproduced keyboard focus dropping to BODY when a pending switch became natively
  disabled. Pending now uses `aria-disabled`/`aria-busy`, rejects repeat interaction and retains
  the confirmed value without removing keyboard focus. Final runtime recaptures remain pending.
- Security review identified query-only backup success notices that could claim successful
  delivery/removal without corresponding stored state. Both focused forged-notice cases failed
  before the fix. Those two notices were removed in favor of the stored destination/delivery
  summary; failure feedback remains. The focused green run passed 7 files and 77 tests, including
  the forged notices, switch pending/focus/duplicate suppression, shared switch/auth shell,
  diagnostic report copy equality, embed hierarchy and auth error distinction.
- Two independent domain reviews found no remaining domain regression in the corrected import
  warning, complete export references or sample-only diagnostics: counter staff importing records
  (`/tmp/polish-settings-domain-1.md`) and crew interpreting imported evidence/diagnostic outcomes
  (`/tmp/polish-settings-domain-2.md`). These were source reviews, not clinical/provider validation.
- Root's C09 live interaction retained the focused INPUT with role switch and its confirmed old
  value during pending, then retained focus after the successful save. The preference was restored
  to true. This verifies the focus fix through a real local action, not only JSDOM behavior.
- Root exercised all nine allowed C07 radio formats. Calendar/Grid/Courses local iframes loaded
  actual demo content; a selected departure's preview `show` matched copied-code `data-show`;
  crossing to Courses reset the old departure and offered every course. Other inspected format
  target/code pairs, review frame, QR image/download and partner output agreed. This does not prove
  third-party CMS behavior, actual lightbox opening, connected payment or provider calls.
- Required departure selection reproduced a separate red regression: Copy offered instruction
  text as code. The code/preview sections now wait for a real snippet and the selector uses normal
  helper text once. The focused embed and fixture tests passed afterwards. Final 390/768 rendered
  resize and missing-selection captures remain the root's post-checkpoint work.
- Critic accepted the expanded export index, full per-file notes and open activity Filter states.
  Local diagnostics only exercised an absent extension, so sample-result and open-report pixels
  remain CI-fixture proof, not a completed live-extension or agency check.
- Final security source review (`/tmp/polish-settings-security-final.md`) found no actionable
  findings after the backup-notice fix and gated fixture review. Calendar screenshot redaction
  changes only visible URL paragraphs: original disposable test capabilities may remain in React
  action state, network responses and failure traces. No general artifact sanitization is claimed.
- Checkpoint validation: 28 focused files passed 248 tests, followed by 8 affected files and 113
  passing tests after the bounded component/helper extractions, plus 6 critical-text guard tests.
  Lint, typecheck and every `check:repo` guard passed on the checkpoint tree. Size budgets only
  decreased: onboarding left the over-400-page ratchet, and palette's file budget fell 937→923.
  Full local production build/E2E suites were not run; hosted CI, current-parent integration and
  the final combined visual verdict remain outstanding.

### Local embed origin

The first dev captures requested the canonical `https://dive.day` iframe and reached a browser
error page. This is not proof of a loaded preview. For local verification, use the supported
`APP_HOST` process override from `src/lib/notifications/app-url.ts`; it accepts HTTP loopback only
outside production. Root's bounded capture command is:

```bash
APP_HOST=http://localhost:3000 DIVEDAY_DEV_MEMORY_BUDGET_MB=6144 pnpm dev
```

Use the actual serving port if different. This changes only the local server's configured public
origin; no preview host heuristic, request-header-derived origin or production snippet behavior
was introduced. Root's loaded local iframe checks above supersede the earlier failed-origin capture.

Each pnpm worktree needs its own `node_modules`, installed with `pnpm install --frozen-lockfile`.
Do not symlink that directory between worktrees: pnpm 12 auto-install replaced a shared symlink
target during this session and temporarily removed the primary checkout's dependencies. Root
restored 1,100 cached packages in 5 seconds with the frozen lockfile, removed the shared symlink,
and verified both worktrees' binaries. Package/lock files and application source were unchanged by
that repair. No global configuration or dependency version change was made.

Temporary capture paths are local evidence, not public PR attachments. Preserve sanitized images
and final-head review results with the implementation PR before closing the visual loop.
