# Visual triage: reading the PR comment

Part of the **visual-triage** skill ([SKILL.md](SKILL.md)). Read it on every pull request with a visual report, before opening a diff image: what the sticky comment says, which baseline you are compared against, why to rebase first, what a PR captures, and how to read a stacked layer's slice.

## Start at the PR comment

On a pull request the `visual-report` job posts one sticky comment (marker `diveday:visual-summary`,
edited in place on each push) with the counts, the names of the changed/new/deleted surfaces, and
the exact `pnpm visual:report` command for that commit. Read it before anything else — it usually
tells you whether the diff is confined to the surfaces you touched. It never fails the build; the
enforcement is you (ADR 20260802-visual-diff-pr-comment).

Two things it says that reg-suit's own `reg-suit[bot]` comment and `reg` status cannot, because
their payload is counts only:

- **Which surfaces moved**, so triage can start without opening a browser.
- **Whether anything was compared at all.** A headline of `NOTHING WAS COMPARED` means reg-suit
  downloaded zero baseline images and reported every screenshot as *new* rather than diffed — the
  changed count is then a meaningless zero (ADR 20260729-reg-suit-visual-regression). Treat that run
  as *unknown*, never as clean, and fix the baseline resolution before reading anything into it.
  A run that really did compare says "no differences across N compared surface(s)" instead.

If the comment says no report was published, `reg-suit run` never got far enough to publish one —
read the `visual-report` job log rather than assuming the pixels held still.

**On any branch, the baseline is your own parent commit — not current `main`.** A branch cut a few
days ago is compared against the world as it was then, so every PR that merged in between shows up
in *your* report as changed pixels. That is not a subtle effect: a branch cut four PRs back came
back with 102 changed surfaces of which **66 belonged to other people**, and the four "new, no
baseline" items were another PR's brand-new captures. Triaging that honestly means opening diffs
for surfaces you never touched and attributing each one, which is slow and easy to get wrong in the
generous direction.

So **rebase onto current `main` before triaging**, and let CI re-run. The report then contains your
pixels and nothing else, which is the only version of it you can actually account for. If you
cannot rebase yet — `main` is red, or the fix is still in review — say so in the PR and attribute
the inherited surfaces explicitly by naming the PR each one came from; a reviewer cannot tell them
apart from yours by looking.

**A pull request captures what its diff can reach, not everything.** `visual-plan` in `ci.yml`
(`scripts/visual-affected.mjs`) picks the captures whose test visits a route the diff reaches,
following each changed name through its importers, layouts and pages (a changed message key or
`public/` asset through the modules that name it), plus a smoke set; every other surface is copied
from the baseline before the compare (`scripts/visual-fill.mjs`), so it reads as passed, and the
sticky comment says how many were captured. A diff it cannot bound (the e2e harness, the seed or
schema, a stylesheet, a root config, `ci.yml`) captures everything, and the push to `main` always
captures everything and is the only baseline. If a surface you expected to move
reads as passed, the selection missed it: add the `visual-all` label to the pull request and push
again, and file what it missed.

**On a stacked pull request, read that comment on every layer.** A layer's baseline is its fork
point from `main`, like any branch's (`scripts/reg-suit-keys.mjs`, ADR
20260919-stack-ci-cancels-superseded-layers), so its diff carries every surface the layers below it
changed as well as its own. Name the layer each inherited diff came from before approving it. That
is the decided key, not a fallback: do not try to point reg-suit at the layer below.

To see one layer's own slice, compare its captures to the layer below's instead of to a baseline:

```bash
pnpm visual:layers --from <layer-below-head> --to <this-layer-head> --download
```

It reads each commit's published `actual/` captures by ETag over HTTP `HEAD` (no image downloads,
about a minute for the suite), lists the ones whose bytes differ, and with `--download` fetches both
images of each into `.reg-report/layers/` and states the geometry change or the pixel count, largest
channel delta and box. On #1948, layer 4 of four, the report said 336 changed and the layer had
moved 4. Both commits must have published captures (every layer runs CI, ADR
20261003-every-stack-layer-runs-ci); it says so when one did not. A reading aid, never a gate.

**Across pushes, compare names, not counts.** The sticky comment lists what *entered* and *left*
the changed set since the head it last reported on, computed from both commits' `out.json`. To do it
by hand between two heads, as sets (`comm` needs both sides sorted; `-13` is what entered, `-23`
what left):

```bash
pnpm visual:report --commit <old> && pnpm visual:report --commit <new>
moved() { grep -E '^## .+ \((changed|new|deleted)\)$' ".reg-report/$1/REPORT.md" | sed -E 's/^## //; s/ \([a-z]+\)$//' | sort; }
comm -13 <(moved <old>) <(moved <new>)   # entered the changed set
comm -23 <(moved <old>) <(moved <new>)   # left it
```

A count that falls by one can hide four leaving and three entering; one of those three on #1922 was
a nondeterministic capture that would have become the next baseline.
