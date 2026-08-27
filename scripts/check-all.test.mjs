import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { phases } from "./check-all.mjs";

/**
 * `pnpm check` is the pre-commit gate, so this file cannot run it — that is the whole
 * suite, from inside the whole suite. What it can pin is the two properties the phase
 * table exists for, both of which are invisible at a glance and both of which regressed in
 * the serial chain this replaced: that no phase pays a redundant second run of something
 * another phase already does, and that no phase walks into the `--` trap its own sibling
 * guard refuses.
 */

describe("the check phase table", () => {
  it("gives every phase a distinct label, since the label is how a failure is named", () => {
    const labels = phases.map((phase) => phase.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  /**
   * The serial chain ran `check:critical-text` twice — once on its own and once inside
   * `check:repo`, which has spawned it since the guards table was written. Nothing noticed,
   * because a check that passes twice looks exactly like a check that passes.
   */
  it("runs nothing that check:repo already spawns", async () => {
    const spawnedByRepo = [
      ...(await readFile(new URL("./check-repo.mjs", import.meta.url), "utf8")).matchAll(
        /"(check-[\w-]+\.mjs)"/g,
      ),
    ].map((match) => match[1]);

    const spawnedHere = phases
      .flatMap((phase) => [...phase.args, ...(phase.andThen?.args ?? [])])
      .map((argument) => argument.replace(/^scripts\//, ""));

    for (const script of spawnedHere) {
      if (script === "check-repo.mjs") continue;
      expect(spawnedByRepo, `${script} would run twice per gate`).not.toContain(script);
    }
  });

  /**
   * Every phase runs its binary directly rather than through `pnpm <script>`, which is what
   * keeps it clear of the separator trap `scripts/guard-bash.mjs` refuses: a `--` handed to
   * a pnpm *script* is forwarded rather than consumed, and the flags after it are dropped
   * in silence.
   */
  it("passes no bare `--`, and no phase shells out to a package script", () => {
    for (const phase of phases) {
      for (const step of [phase, phase.andThen].filter(Boolean)) {
        expect(step.args, phase.label).not.toContain("--");
        if (step.command === "pnpm") {
          expect(["exec", "dlx"], `${phase.label} must not go through a package script`).toContain(
            step.args[0],
          );
        }
      }
    }
  });
});
