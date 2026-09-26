# Pixel craft

The standard for **geometry and finish**: whether things that should share an edge share it,
whether content sits where its box says it sits, whether a hover fill or a focus ring behaves at the
edge of the thing it belongs to. A person notices these at once, and the agents who built DiveDay
kept missing them.

This is not a review of design principles. One idea per surface, control count, copy, voice and
composition belong to [principles.md](principles.md), the **design-review** skill and the
`design-critic` agent. This page is what to measure after those questions are answered.

## Method

- **Light only.** The owner's standing rule: "whenever you do checks, you only need to check one of
  light or dark, unless you are explicitly doing color-related work! This is true in general."
  Geometry does not change with the scheme. Open dark mode only to confirm a defect that is itself
  about colour. CI's visual matrix still captures both schemes, because that is the safety net for
  colour regressions.
- **Measure before asserting.** Read geometry from the rendered box, never from the class string.
  The cascade decides what renders: `px-0` loses to a size's `px-4` because of stylesheet order
  (a417831), a vertical margin does nothing to an inline box (a1c5500), and an unlayered rule in
  `globals.css` beats every layered Tailwind utility, whatever its specificity. The pixel probe
  (below) does the measuring.
- **Tiles and crops, never whole pages.** The 390px manifest capture is 5,539px tall. Viewed whole,
  it is scaled down until a 4px offset disappears. Judge detail from the 1:1 tiles
  (`node scripts/pixel-probe-report.mjs --tiles <capture>`) and the probe's upscaled crops.
- **Describe the pixels before reading the source.** Write down the edges each section aligns to,
  the gap between siblings, and the padding on each side of each box. Then open the code. Reading
  the code first shows you what it was meant to render.
- **Find the longest real value.** A rail sized for "11:00 AM" wrapped "11:30 PM" (66e2c4f). A
  clamp sized for one shop name clipped the next (55cf41c). Seed values are short and tidy; real
  ones are not.
- **Lift `body { overflow-x: clip }` before you measure sideways overflow.** `globals.css` hides it
  from `scrollWidth`. `e2e/waivers.spec.ts` and the probe both lift it, and put it back in the same
  step.
- **Reg-suit is not a verdict.** It diffs against the parent commit, so a defect present when its
  baseline was taken is part of the baseline (#1910).
- **The probe proposes; you decide.** Every flag gets a verdict: *confirmed*, with the measurement,
  or *dismissed*, with the reason. A flag that is right as it is goes in
  `scripts/pixel-probe-settled.json` and gets a row in [settled-questions.md](settled-questions.md),
  both pointing at the code comment that explains it. The probe cannot see everything; the "eyes
  only" classes below are yours.
- **Fix at the layer that owns the defect.** A shared component's flaw is fixed in the component,
  and every call site follows. A hand-rolled class string that should have been a component becomes
  that component. Never cancel a variant's styles at a call site. Never fake centring with a nudge
  (`mt-[3px]`, `-translate-y-px`): find out why the content is not centred. The usual causes are
  line-height, a glyph's side bearings, an inline SVG sitting on the baseline, a border on one
  side, or `items-start`.

## The pixel probe

`scripts/pixel-probe/` measures every surface the visual suite reaches. With `PIXEL_PROBE=1`, the
`capture()` function in `e2e/visual.spec.ts` probes each light capture after each viewport's
screenshot:

- It collects one geometry snapshot of the whole document.
- At 1280px it forces `:hover` and `:focus-visible` through DevTools. No event fires and the mouse
  never moves.
- It sweeps the tight edge of each Tailwind band: 360, 640, 768 and 1024px.

CI never sets the flag. Flag-on runs produce baselines byte-identical to flag-off runs.

```sh
PIXEL_PROBE=1 pnpm e2e:run e2e/visual.spec.ts --grep "light mode" --reporter=line   # everything, 20–40 min
PIXEL_PROBE=1 pnpm e2e:run e2e/visual.spec.ts --grep '<test title>' --reporter=line  # one capture
node scripts/screenshot.mjs <path> --probe                                           # no capture: against pnpm dev
node scripts/pixel-probe-report.mjs            # e2e/pixel-probe/REPORT.md, clusters.json
node scripts/pixel-probe-report.mjs --tiles <capture>
node scripts/pixel-probe-report.mjs --atlas    # every control signature at rest, hover, focus
```

`REPORT.md` groups flags by **cluster**: the check, the component signature, and the signature of
the container it sits in. One shared component's flaw is one line listing every surface it
reaches. The report also groups flags by surface family, and prints the command that re-probes
each capture. It counts skipped records, so "no findings" and "never ran" never look alike.

## Severity

- **S1, broken:** unreadable, unreachable, overlapped, clipped, or scrolling sideways.
- **S2, visibly off:**
  - a misalignment or asymmetry of 2px or more;
  - unequal spacing between siblings;
  - a shift on hover or focus;
  - a fill whose corners don't match its container;
  - a clipped focus ring, or a missing focus state;
  - one component drawn two ways.
- **S3, polish:** an optical offset of 1px or less, a widow, a minor break in rhythm.

## The numbers

From `src/app/globals.css` and [forms-and-controls.md](forms-and-controls.md). Where a doc
disagrees with the code, the code wins and the doc is wrong.

| What | Value | Where |
| --- | --- | --- |
| Radius ladder | control 12 (`rounded-lg`) · inset 12 (`rounded-inset`) · panel 20 (`rounded-panel`) · pill | `--radius`, `--radius-inset`, `--radius-panel` |
| Nested radii | outer less the inset: on a segmented track or in a menu panel 7 (12 − 1 − 4); flush in a card 19 (20 − 1) | `SEGMENT_CORNER` in `ui/segmented.ts` (`MENU_PANEL` in `ui/menu.ts` takes the track's inset), `PANEL_INNER_RADIUS` in `ui/card.tsx` |
| Focus ring | 3px outline at a 2px offset, so it reaches **5px** outside the box; `focus-ring-inset` is the same 3px at −3px, for a row flush in a clipping container | `:where(a, button, …):focus-visible` in `@layer base`; `@utility focus-ring`, `focus-ring-inset` |
| Chrome bar | 56px (`--chrome-h`); anything pinned under it offsets by the token | `--chrome-h` |
| Buttons | `md` 48px with a 16px label; `sm` 44px with 14px; `icon` a 48px square; `boat` 56px. **One size per row** | `src/components/ui/button.ts` |
| Text controls | 16px type; `field` 44px, `md` 48px. **A row with a text control in it is an `md` row** | `controlClassFor` in `src/components/ui/form.tsx` |
| Targets | ≥ 44px, measured on the element's own box (a stretched `::after` counts only as far as its clipping ancestors let it) | principles.md §2 |
| Rows | a `LedgerRow` is never under 52px (`md`); `lg` is 56px | `src/components/ui/ledger.tsx` |
| Section rhythm | `space-y-10` between a page's sections, never `mt-*` | forms-and-controls.md |

## The twelve classes

Each class gives its rule, its tolerance, its usual severity, the probe check that measures it (or
*eyes only*), and a defect from this repo's history.

### 1. Centring on both axes

- **Rule.** Content sits centred where the box's styles ask for centring. It is judged against the
  edges a person can see: a fill, a shadow, or a pair of borders. A spread three-part row centres
  its middle part. Text beside a taller control shares its centre, first line or baseline.
- **Tolerance.** 1px. More than 1px is S3; 2px or more is S2.
- **Probe.** `off-centre`, `three-part-row`, `text-beside-control`.
- **History.** Labels sat at the top of 44px targets until centring moved into the shared
  primitives (800e99d, #56). `Pager` put an empty `<span>` in the missing side of a
  `justify-between` row, so the position readout sat 28px left of centre on page 1 and moved
  from page to page. Three columns with the outer two equal (`grid-cols-[1fr_auto_1fr]`) fixed
  it from `sm` up and not on a phone: `1fr` is `minmax(auto, 1fr)`, so the widest readout left
  the outer columns unequal and sat 25–28px off centre at 390 and 360. Below `sm` the readout now
  has a row of its own over the links.

### 2. Icons and glyphs

- **Rule.** Icons and glyphs are optically centred and sized to the text they sit with. A caret
  reads as a caret.
- **Tolerance.** Optical; about 1px.
- **Severity.** S3. It is S2 when the glyph reads as something else.
- **Probe.** Eyes only. The probe measures an SVG's box, not its ink.
- **History.** A disclosure caret read as a stray dot (d6a7398, #459).

### 3. Shared edges

- **Rule.** A column has one left edge. Siblings that should line up line up by their content or
  their painted box. The same child sits at the same x in every repeated row.
- **Tolerance.** 0. Edges 1–12px apart are the defect; more than 12px apart is a deliberate indent.
- **Severity.** S2.
- **Probe.** `ragged-edges` and `ragged-column`. Both are leads (see precision below).
- **History.** Three left edges on one page (a417831). Disclosures at x = 428, 538 and 488 in one
  list (d6a7398).

### 4. Spacing rhythm

- **Rule.** Siblings of one kind sit at one gap. A zero-size child never adds a gap it does not
  fill.
- **Tolerance.** 2px between like siblings. A phantom gap is always a defect.
- **Severity.** S2.
- **Probe.** `uneven-gaps`, `phantom-gap`.
- **History.** A 28px phantom gap under `SegmentedControl` (abff054). A settings row's label sat
  2px high because an empty description still took its `gap-1`.

### 5. Padding symmetry and consistency

- **Rule.** A box's opposite sides match unless the asymmetry is the design. Sibling rows share an
  inset. A hover fill leaves at least 4px around its content.
- **Tolerance.** 1px between opposite sides; 0 between siblings; 4px of fill.
- **Severity.** S2.
- **Probe.** `off-centre` (it reports lopsided padding), `fill-tight`, and the census's row insets.
- **History.** A link's `px-0` lost to its size's `px-4` and rendered 16px inside the text above it
  (a417831). `SettingsRows` use `px-4 sm:px-5` where `DisclosureRow` uses `px-5 sm:px-6`.

### 6. Boxes, borders and radii

- **Rule.** A painted box near a rounded ancestor's corner takes the ancestor's radius minus the
  inset. Radii stay on the ladder, except a nested corner derived from its ancestor, spelled only
  as `SEGMENT_CORNER` / `PANEL_INNER_RADIUS`. An edge has one border, never two stacked.
- **Tolerance.** 2px on the nested radius, checked within 8px of the corner.
- **Severity.** S2.
- **Probe.** `nested-corners`, `fill-corners`. Double borders are eyes only.
- **History.** A double border (e174e0a). `SegmentedControl`'s 12px pill sat 6px inside a 12px
  track, where it nests at 6px, and its options 5px, where they nest at 7px. The extra pixel was a
  placement bug, the pill measured from the track's border edge, not its padding edge; with that
  fixed one derived corner, 7px, serves both. The manifest's "On this phone" summary put a 12px
  hover fill flush in a 20px corner that does not clip. The three header menus (identity, When,
  language) put 12px rows 9px inside a 12px panel; the panel took the track's `p-1` inset so its
  rows take the same 7px.

### 7. Interaction states

- **Rule.**
  - Hover and focus change paint, never layout.
  - Every focusable thing shows the global ring, or its inset twin where it is flush with a
    clipping edge, and nothing clips it.
  - A hover fill follows its container's corner.
  - Targets clear 44px.
  - A tap highlight follows the control's radius.
- **Tolerance.** 0px of layout shift. The full 5px ring must be visible.
- **Severity.** S2.
- **Probe.**
  - `hover-shift`, `focus-shift`, `focus-invisible`, `focus-ring-differs` and `fill-corners`, all
    forced at 1280px;
  - `focus-ring-clipped` at every width;
  - `small-target` at 390px and 820px.
- **History.** A square tap highlight behind a rounded input (#782). A near-miss tap that reflowed
  every row below it (15f8656).

### 8. Text wraps, widows and truncation

- **Rule.**
  - A unit that must stay whole never wraps: a time and its meridiem, a price, a name and its
    badge.
  - A clamp or ellipsis is sized for the longest real value.
  - A heading has no one-word last line.
- **Tolerance.** No unit split.
- **Severity.** Widows are S3. A split unit, or truncation that hides meaning, is S2.
- **Probe.** `truncated` (a lead: it reports every truncation that is actually cutting) and
  `text-spill`. Widows are eyes only.
- **History.** A wrapped meridiem on the day spine's time rail (66e2c4f). A clamp sized for one
  shop name clipped the next (55cf41c).

### 9. Overflow, clipping and sticky chrome

- **Rule.**
  - The page never scrolls sideways.
  - No text is hard-clipped.
  - No focus ring is cut by an `overflow-*` ancestor.
  - Sticky chrome never covers a target or a heading someone was sent to.
- **Tolerance.** 0.
- **Severity.** S1, except a clipped ring, which is S2.
- **Probe.** `page-overflow`, `hard-clip`, `text-spill`, `focus-ring-clipped`. Sticky overlap is
  eyes only.
- **History.** A back-link half hidden under the sticky staff bar (#1941). A tab strip 3px too
  wide for the phone it is read on (fa26f83).

### 10. Responsive seams at 640, 768, 1024 and 1280px

- **Rule.** At the tight edge of every Tailwind band, classes 1–9 still hold. 360px sits below the
  390px floor and is reported on its own.
- **Tolerance.** As for the class that breaks.
- **Severity.** As for the class that breaks.
- **Probe.** The width sweep runs `page-overflow`, `text-spill`, `hard-clip`, `off-centre`,
  `three-part-row`, `mismatched-controls` and `text-beside-control` at 360, 640, 768 and 1024px.
  The 820px capture covers the tablet surfaces.
- **History.** fa26f83 again: the tab strip fitted in English and not in Spanish.

### 11. Loading, empty and error geometry

- **Rule.** A skeleton has the loaded page's geometry, so nothing shifts when content arrives.
  Empty and error states obey classes 1–9 like any other state.
- **Tolerance.** 0px of shift on load.
- **Severity.** S2.
- **Probe.** Eyes only. The probe measures whatever state a capture shows, so an empty or error
  capture is probed like any other.
- **History.** A skeleton became the `dive-sites-library` baseline (#641). A marketing section that
  never revealed was captured blank and became the baseline (#1910).

### 12. One component drawn two ways

- **Rule.** One component renders at one height, inset, radius and font size wherever it appears.
  Every control in a row shares one height and one type size. A group title sits in the same place
  relative to its card everywhere.
- **Tolerance.** 0. Values 1–3px apart within one component family are the defect; bigger steps
  are deliberate sizes.
- **Severity.** S2.
- **Probe.** The census's near-misses (in `REPORT.md`), `mismatched-controls`,
  `focus-ring-differs`, and the state atlas.
- **History.** A 16px button beside a 14px one (5a81e94). Group titles inside some cards and
  outside others (#624). A neutral `Badge` carried a border the toned badges did not, 30px beside
  28px, until its edge became an inset ring.

## Precision

The probe's checks were calibrated on ten capture groups: landing, public schedule, public trip,
sign-in, Today, the trip page, the manifest, the schedule builder, settings and orders. Every flag
was read and given a verdict, and the checks were tuned until most flags were true defects. A check
under 70% precision produces **leads**, not findings: read them, but a flag from one is not a
finding until you have confirmed it.

Then they were audited on 36 capture groups. Each flag in each capture got a verdict with its
measurement: 6,192 flags, 5,571 confirmed and 621 dismissed, 90% precision. The three atlas groups
re-count, by control signature, flags the surface groups also count; without them it is 4,271 flags
and 86%, and only `fill-tight` reads differently (91%).

| Check | Flags | Confirmed | Dismissed | Precision | Standing |
| --- | --- | --- | --- | --- | --- |
| `focus-ring-clipped` | 3,400 | 3,318 | 82 | 98% | finding |
| `small-target` | 990 | 990 | 0 | 100% | finding |
| `ragged-edges` | 404 | 88 | 316 | 22% | lead |
| `fill-tight` | 298 | 283 | 15 | 95% | finding |
| `phantom-gap` | 196 | 118 | 78 | 60% | lead |
| `mismatched-controls` | 182 | 182 | 0 | 100% | finding |
| `truncated` | 156 | 137 | 19 | 88% | lead by design |
| `fill-corners` | 144 | 144 | 0 | 100% | finding |
| `ragged-column` | 89 | 33 | 56 | 37% | lead |
| `nested-corners` | 85 | 85 | 0 | 100% | finding |
| `three-part-row` | 84 | 84 | 0 | 100% | finding |
| `off-centre` | 38 | 38 | 0 | 100% | finding |
| `text-spill` | 38 | 7 | 31 | 18% | lead |
| `uneven-gaps` | 34 | 30 | 4 | 88% | finding |
| `hard-clip` | 34 | 34 | 0 | 100% | finding |
| `text-beside-control` | 20 | 0 | 20 | 0% | lead |
| `page-overflow`, `hover-shift`, `focus-shift`, `focus-invisible`, `focus-ring-differs` | 0 | — | — | — | proven by fixture pairs only |

The dismissals were mostly a few probe errors, each repeated on many captures. These checks changed
after the audit:

- **`ragged-edges`.** 305 of its 316 dismissals were three errors.
  - The painted-box walk stopped two levels short of the content walk. The staff chrome's logo
    tile sits six levels under the header, so the probe read the "BM" inside it (23.8px) as the
    header's edge instead of the tile's 16 (189 flags). Both walks now share one depth.
  - The content walk cached a depth-dependent answer by element alone. An outer stack stored
    `CompactDisclosureRow`'s `-mx-2` summary as its own x, and the row read 8px out of its column
    (108). The cache is keyed by depth too.
  - Centred text was given a left edge (8). It now offers none; a centred card still offers its box.
- **`text-beside-control`.** All 20 were a caption stacked over its field inside a `<label>` whose
  box ran beside the row's button. The first line itself must now sit beside the control.
- **`focus-ring-clipped`.** All 82 were the command palette's `tabindex="-1"` options, which focus
  never reaches: the combobox keeps it and moves `aria-activedescendant`. An element with a negative
  tabindex is no longer forced into `:focus-visible`, and is still hovered and still a target.
- **`text-spill`.** 13 were a space kept at a `pre-wrap` wrap, hanging past the line's end;
  preserved text is now measured by its words alone. 17 were the year strip's month labels, which
  are settled.
- **`phantom-gap`.** Most were an empty slot in a row spread by `justify-content: space-between`
  (or `-around`, `-evenly`), whose free space takes the gap. Such a row is left alone while it has
  free space, unless the empty slot doubles its neighbours' measured spacing.
- **`ragged-column`.** Most were a child whose x is the length of the words before it: an inline
  mark running on after words (a required "*", a legal term's " — ", a link mid-sentence), or a
  glyph closing its own label's box ("Edit details ⌄"). Both are left alone. A caret that is its
  own item after a name is still flagged.
- **`truncated`.** 13 of its 19 dismissals are settled: a departure's collapsed About line, the
  storefront bar's shop name, and Today's first-run checklist link.

The standings above are the audit's. They move only when the next audit measures them.

Before tuning, most checks were noise:

- `nested-corners`: 63 flags, 11% true.
- `off-centre`: 61 flags, 3% true.
- `text-spill`: 126 flags, 1% true.

Each fix is recorded as a "leaves alone" case in `scripts/pixel-probe/analyze.test.mjs`:

- a card's border was not subtracted from the inset;
- bands painted the page's own colour were counted as painted;
- wrapped text aligned to the start was counted as off centre;
- a tight line-height's font overhang was counted as spill;
- a painted tile six levels down was read by the words inside it;
- a row's edge depended on which stack reached it first;
- centred text was given a left edge;
- a caption stacked over its field was read as text beside a button;
- an option no keyboard focuses was forced into focus;
- a space hanging at a `pre-wrap` wrap was counted as spill (in `collect.test.mjs`);
- an empty slot in a spread row with free space was read as a doubled gap;
- a mark after words, and a caret closing its own label's box, were read as a wandering column.

Every check also has a flagging fixture and a correct twin that must not be flagged, in
`e2e/pixel-probe.spec.ts`. A check with no flags on the calibration surfaces is proven by its
fixture pair and nothing more.
