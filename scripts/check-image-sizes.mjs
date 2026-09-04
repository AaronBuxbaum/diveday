import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { candidatePool, fetchedCandidate, resolveSizes } from "./image-sizes-lib.mjs";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * **Every `sizes` attribute is checked against the slot it actually fills**
 * (issue #1350).
 *
 * The visual suite structurally cannot see this class of change. `pnpm
 * e2e:build` sets `DIVEDAY_E2E=1`, `next.config.ts` turns that into
 * `images.unoptimized`, and Next then returns `{ srcSet: undefined, sizes:
 * undefined }` from `generateImgAttrs` — so there is no srcset for `sizes` to
 * select from, and the attribute is not even in the DOM for a Playwright
 * assertion to read. PR #1347 changed a `sizes` from `25vw` to `180px`, taking
 * the fetched candidate from 1080px to 384px for a 171px slot, and reg-suit
 * reported 0 differences across 732 surfaces with a baseline resolved. A real
 * comparison that could not see it.
 *
 * The switch is right and stays — sharp's lossy re-encodes are not
 * bit-reproducible, which once made the course-page captures a coin flip. So
 * this is arithmetic over the source instead of pixels.
 *
 * **Two defects, and they fail differently.** An under-declared `sizes` fetches
 * a candidate smaller than the slot and ships a visibly soft image to a diver.
 * An over-declared one is invisible and wastes their bandwidth — and worse than
 * it looks, because `getWidths` filters the whole candidate pool by the
 * smallest `vw` in the string, so an over-declared `vw` removes the small files
 * from the srcset rather than merely failing to pick one.
 *
 * **The comparison is the fetched candidate, not the raw number.** Declaring
 * 352px for a slot measured at 355 is not a defect: both land on the same file.
 * Comparing candidates is what makes the check about bytes a diver downloads
 * rather than about arithmetic nobody can act on, and it is what lets the
 * tolerance below be one step of a discrete ladder instead of a percentage
 * somebody has to argue about.
 *
 * **Two ways a slot's width is known**, and the first needs no maintenance:
 *
 * 1. **Derived** — a bare `Npx` on an element whose own Tailwind class fixes
 *    its width (`size-12`, `w-32`). The guard reads the class. Change `size-12`
 *    to `size-16` and forget the `sizes`, and this fires. No drift, nothing to
 *    keep in step.
 * 2. **Registered** — everything responsive, in `scripts/image-sizes.json`,
 *    measured in a real browser against `pnpm dev` (where the optimizer is on)
 *    and recorded per viewport. This is the half that can drift: change a
 *    container's `max-w-*` and the guard keeps checking the old number. It is
 *    the cost the issue named for this shape, and the only shape where the
 *    optimizer switch is irrelevant rather than worked around. An entry nobody
 *    has measured says `exempt` with a reason naming the surface, the way
 *    `scripts/route-coverage.json` does — a written gap beats a guessed number.
 */

const ROOT = process.cwd();
const REGISTRY = "scripts/image-sizes.json";

/** Phone, tablet, laptop, desktop. */
const VIEWPORTS = [390, 768, 1280, 1920];

/**
 * How far above the ideal candidate a declaration may land. One step of the
 * candidate ladder absorbs a container's own padding — a `50vw` cell inside a
 * padded grid is honestly declared and measures a little under half the
 * viewport. Two steps is a file a diver did not need: #1347's case was four.
 */
const CANDIDATE_SLACK_STEPS = 1;

/** Tailwind's spacing scale: one unit is 0.25rem, and the root font is 16px. */
const TAILWIND_UNIT_PX = 4;

/** Files whose `sizes` is a variable; the literal is checked at the call site. */
const PASS_THROUGH = new Set([
  "src/components/StoredPhoto.tsx",
  "src/app/shop/[shopSlug]/divers/[personId]/_components/GearAndSizes.tsx",
]);

/**
 * The width this element's own Tailwind class fixes it at, or null.
 *
 * `block` is the text from the element's opening tag to its `sizes`, never
 * further back: the first `className` in a wider window is the *parent's*
 * (`<li className="flex min-w-0 gap-3">` wrapping a `<StoredPhoto>`), which has
 * no width class, and reading it would silently downgrade every derived
 * declaration to "needs a registry entry".
 */
function fixedWidthFromClasses(block) {
  const className = block.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
  if (!className) return null;
  const classes = (className[1] ?? className[2]).split(/\s+/);
  for (const cls of classes) {
    const match = cls.match(/^(?:size|w)-(\d+(?:\.\d+)?)$/);
    if (match) return Number(match[1]) * TAILWIND_UNIT_PX;
  }
  return null;
}

async function declarationsInTree() {
  const listed = readBounded("git", ["ls-files", "src/**/*.tsx"], {
    cwd: ROOT,
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
  })
    .split("\n")
    .filter((file) => file !== "" && !file.includes(".test."));

  const found = [];
  for (const file of listed) {
    const text = await readFile(path.join(ROOT, file), "utf8");
    if (PASS_THROUGH.has(file)) continue;
    for (const match of text.matchAll(/\bsizes=/g)) {
      const at = match.index + match[0].length;
      // A `sizes` is either one literal or an expression choosing between
      // several — `TripDayPlan` picks its declaration off the length of the
      // list it is laying out, which is the honest way to write one for a
      // conditional grid. Every literal inside the expression is a declaration
      // in its own right and each is checked.
      let region;
      if (text[at] === '"') {
        region = text.slice(at, text.indexOf('"', at + 1) + 1);
      } else if (text[at] === "{") {
        let depth = 0;
        let end = at;
        for (; end < text.length; end += 1) {
          if (text[end] === "{") depth += 1;
          else if (text[end] === "}") {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        region = text.slice(at, end + 1);
      } else continue;

      const literals = [...region.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      if (literals.length === 0) continue;

      const line = text.slice(0, match.index).split("\n").length;
      // Back to this element's own opening tag, so the class read below is its
      // own rather than a wrapper's.
      const before = text.slice(0, match.index);
      const tagStart = Math.max(before.lastIndexOf("<"), 0);
      const block = text.slice(tagStart, match.index);

      for (const sizes of literals) found.push({ file, line, sizes, block });
    }
  }
  return found;
}

function stepsApart(sizes, from, to) {
  const pool = candidatePool(sizes);
  return pool.indexOf(to) - pool.indexOf(from);
}

function check(declaration, renderedByViewport, problems) {
  for (const viewport of VIEWPORTS) {
    const rendered = renderedByViewport[String(viewport)] ?? renderedByViewport.fixed;
    if (typeof rendered !== "number") {
      problems.push(
        `${declaration.file}:${declaration.line}: ${REGISTRY} has no rendered width at ${viewport}px.`,
      );
      continue;
    }
    let resolved;
    try {
      resolved = resolveSizes(declaration.sizes, viewport);
    } catch (error) {
      problems.push(`${declaration.file}:${declaration.line}: ${error.message}`);
      return;
    }
    for (const dpr of [1, 2, 3]) {
      const declared = fetchedCandidate(declaration.sizes, resolved, dpr);
      const ideal = fetchedCandidate(declaration.sizes, rendered, dpr);
      const steps = stepsApart(declaration.sizes, ideal, declared);
      if (steps < 0) {
        problems.push(
          `${declaration.file}:${declaration.line}: under-declared at ${viewport}px, DPR${dpr} — ` +
            `sizes resolves to ${Math.round(resolved)}px for a slot rendered at ${rendered}px, so the ` +
            `browser fetches a ${declared}px candidate where the slot needs ${ideal}px. This ships a ` +
            `visibly soft image.`,
        );
        return;
      }
      if (steps > CANDIDATE_SLACK_STEPS) {
        problems.push(
          `${declaration.file}:${declaration.line}: over-declared at ${viewport}px, DPR${dpr} — ` +
            `sizes resolves to ${Math.round(resolved)}px for a slot rendered at ${rendered}px, so the ` +
            `browser fetches a ${declared}px candidate where ${ideal}px would do (${steps} steps up ` +
            `the ladder). Those are bytes on a diver's phone.`,
        );
        return;
      }
    }
  }
}

const registry = JSON.parse(await readFile(path.join(ROOT, REGISTRY), "utf8"));
const declarations = await declarationsInTree();

const problems = [];
const usedKeys = new Set();
let derived = 0;
let registered = 0;
let exempt = 0;

for (const declaration of declarations) {
  const key = `${declaration.file} :: ${declaration.sizes}`;
  const entry = registry[key];
  if (entry) usedKeys.add(key);

  if (entry?.exempt) {
    exempt += 1;
    continue;
  }

  // Derived first: a fixed-px declaration on a fixed-width element needs no
  // registry entry at all, and is the half of this guard that cannot go stale.
  const fixed = /^\d+px$/.test(declaration.sizes) ? fixedWidthFromClasses(declaration.block) : null;
  if (fixed !== null) {
    derived += 1;
    const declaredPx = Number(declaration.sizes.replace("px", ""));
    if (declaredPx !== fixed) {
      problems.push(
        `${declaration.file}:${declaration.line}: sizes says ${declaredPx}px but the element's own ` +
          `Tailwind class fixes it at ${fixed}px. One of the two moved without the other.`,
      );
    }
    continue;
  }

  if (!entry) {
    problems.push(
      `${declaration.file}:${declaration.line}: no entry in ${REGISTRY} for sizes=${JSON.stringify(declaration.sizes)}.\n` +
        `    Measure this slot's rendered CSS width at ${VIEWPORTS.join("/")}px against a running \`pnpm dev\`\n` +
        `    (the optimizer is on there, so \`sizes\` is in the DOM), or add an "exempt" reason naming the\n` +
        `    surface. Key it exactly: ${JSON.stringify(key)}`,
    );
    continue;
  }
  registered += 1;
  check(declaration, entry.rendered ?? {}, problems);
}

for (const key of Object.keys(registry)) {
  // `_`-prefixed keys are the file's own notes to a reader, not entries.
  if (!key.startsWith("_") && !usedKeys.has(key)) {
    problems.push(
      `${REGISTRY}: stale entry for ${JSON.stringify(key)} — no such sizes declaration in the tree.`,
    );
  }
}

if (problems.length > 0) {
  console.error(`image-sizes violations:\n${problems.map((p) => `- ${p}`).join("\n")}`);
  console.error(
    "\nA `sizes` attribute picks which file the browser downloads out of the srcset. The visual suite cannot see it — the e2e build runs with images.unoptimized, so there is no srcset at all — which is why it is checked here. See the docblock in scripts/check-image-sizes.mjs.",
  );
  process.exit(1);
}

console.log(
  `image-sizes: ${derived} derived from their element's own width class, ${registered} checked against measured slots at ${VIEWPORTS.length} viewports` +
    (exempt > 0 ? `, ${exempt} exempt with a written reason` : "") +
    " (the visual suite cannot see any of these — issue #1350)",
);
