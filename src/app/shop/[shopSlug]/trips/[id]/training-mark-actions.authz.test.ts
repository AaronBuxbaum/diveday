import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **The training-mark actions' gate, read off their bodies** (issue #2275),
 * the rule `actions.authz.test.ts` holds for the rest of the trip page: each
 * export of `training-mark-actions.ts` refuses anyone who may not configure
 * trips through the `requireTripConfig` preamble, and nothing new lands in
 * the file without an answer here. Kept beside the file so the trip page's
 * own authz test does not grow.
 */
const source = readFileSync(
  new URL("./training-mark-actions.ts", import.meta.url).pathname
    .replace(/%5B/g, "[")
    .replace(/%5D/g, "]"),
  "utf8",
);

function actionBodies(): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const match of source.matchAll(/^export async function (\w+)/gm)) {
    const name = match[1];
    if (!name || match.index === undefined) continue;
    const end = source.indexOf("\n}\n", match.index);
    bodies.set(name, source.slice(match.index, end === -1 ? undefined : end));
  }
  return bodies;
}

describe("who may mark or clear a training dive", () => {
  it("files every export under the trip-configuration preamble", () => {
    const bodies = actionBodies();
    expect([...bodies.keys()].sort()).toEqual([
      "clearTrainingDiveAction",
      "markTrainingDiveAction",
    ]);
    for (const [name, body] of bodies) {
      expect([name, /await requireTripConfig\(/.test(body)]).toEqual([name, true]);
    }
  });
});
