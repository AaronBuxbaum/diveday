// Finishes a narrowed pull-request capture before reg-suit compares it (code re-review
// 2026-10-13, item 22; the selection is `scripts/visual-affected.mjs`).
//
// A pull request captures only the surfaces its diff can move. Compared as it stands, every
// surface it did not capture would read as *deleted* against the baseline, and the report it
// publishes would be a partial set. So every expected image with no captured counterpart is
// copied into the capture directory first: it then compares as unchanged, and the published
// report is a whole set, the baseline's pixels for what this commit could not have moved and
// fresh ones for what it could. Nothing here ever runs on main, whose run captures everything
// and is the only thing a later commit's baseline is read from.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

/** Every image under `dir`, as a path relative to it. */
function imagesUnder(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next);
      else if (/\.(?:png|jpe?g|webp|gif|tiff?|bmp)$/i.test(entry.name)) found.push(next);
    }
  };
  walk("");
  return found.sort();
}

/**
 * Copies each image in `expectedDir` that `actualDir` lacks. Returns how many were captured and
 * how many were copied, for the note the PR comment carries.
 */
export function fillFromExpected({ expectedDir, actualDir }) {
  const captured = new Set(imagesUnder(actualDir));
  let copied = 0;
  for (const image of imagesUnder(expectedDir)) {
    if (captured.has(image)) continue;
    const target = path.join(actualDir, image);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(expectedDir, image), target);
    copied += 1;
  }
  return { captured: captured.size, copied };
}

/** The sentence the sticky comment carries for a narrowed run. */
export function selectionNote({ captured, copied }) {
  return (
    `This pull request captured ${captured} surface(s) its diff can reach (and the smoke set); ` +
    `the other ${copied} are the baseline's own images, so they read as unchanged here. ` +
    "The push to main captures every surface."
  );
}
