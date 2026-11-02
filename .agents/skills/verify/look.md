# Verify: looking at UI you changed

Part of the **verify** skill ([SKILL.md](SKILL.md)). Read it whenever UI changed, before the first capture: the capture commands, the pixel probe, `scripts/screenshot.mjs`, and why a long capture run kills the dev server.

## 3. UI changed: look at it

For print CSS or paper documents, use [print review](../e2e-and-visual/print.md): inspect the
paginated PDFs as well as the print screenshots.

Never ship UI you haven't seen. The visual spec asserts nothing — it writes PNGs at both the
phone and desktop widths — so a filtered run of it is the capture step. Look in light only; dark
joins it only when the change is colour work (a token, a tint, a hue — the owner's rule,
[H-20260925-many-colour-schemes-check](../../../docs/product/human-decisions/README.md#decision-register)), and the `light mode.*` prefix
is what keeps the run to one scheme:

```bash
pnpm e2e:build
pnpm e2e:run e2e/visual-<feature>.spec.ts -g 'light mode.*<name of the capture group>' --reporter=line
```

Read the PNGs in `e2e/screenshots/` (gitignored) and check them against the checklist at the bottom of
`docs/design/principles.md`. Then probe them: the same run with `PIXEL_PROBE=1` in front, then
`node scripts/pixel-probe-report.mjs`, and give every flag in `e2e/pixel-probe/REPORT.md` a verdict
— the `design-review` skill's pixel pass has the rest, and
[pixel-craft.md](../../../docs/design/pixel-craft.md) the rubric. For significant UI work, also run
the `design-review` skill. Send the screenshots to the user when reporting completion.

Prefer this Playwright-driven capture over backgrounding `pnpm dev` and browsing it manually: the
Playwright commands build, run, and exit on their own, while a backgrounded dev server doesn't —
see the `debug` skill's **Long-running background processes** section ([evidence.md](../debug/evidence.md)) for why a leaked one causes
real problems (stale-server corruption, and sessions getting stuck waiting on a readiness signal
that a leftover process will never emit).

For a surface with no visual-spec capture group yet, or a quick mid-iteration look while a dev
server is already running, use `node scripts/screenshot.mjs <path> [--as owner]` — it captures
the light phone/desktop pair into `screenshots/` (gitignored), `--both` adds dark for colour work,
`--probe` runs the pixel probe on it, and it signs in through the seeded dev credentials for
`/shop/**` paths. Never hand-write a throwaway driver for this; the script exists so scratch
`.shots*.mjs` files stop reaching the index.

**A long capture run kills the dev server, and the corpse takes the next one with it.** Two facts
worth knowing before you point that script at thirty paths:

- A Turbopack `next-server` never unloads a route it has served. On a memory-capped container it is
  OOM-killed
  outright at roughly **thirty page renders** in 16 GB — well inside one capture matrix over a
  handful of staff pages. `scripts/dev-server.mjs` restarts it before the kernel does where it can,
  and `screenshot.mjs` shoots that path again by itself; a kill it cannot come back from is now
  reported as one, naming how many captures landed, rather than as
  "Nothing answering — start `pnpm dev` first" (issue #1321). Capture in smaller batches.
- **Restart with `pnpm dev`, never a bare `next dev`.** A server started over the build state a
  killed one left serves 404 for the routes that one was compiling, in ~50ms of application code
  and before any page code runs, until a file change forces Turbopack to recompile. That reads
  exactly like the change you just made breaking those routes — one session spent most of an hour
  on it, and a `git checkout` that "fixed" it made a correct change look like the cause. The
  supervisor now throws that state away before it starts and prints a `dev:` line saying so (issue
  #1882); a server started any other way needs `rm -rf .next/dev` first.
