#!/usr/bin/env node
/** Persist a prediction before full CI, then compare its first and containment-retry reports. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { affectedSpecs, durations } from "./e2e-affected.mjs";
import { compareShadow, selectionSnapshot, shadowSummary } from "./impact-shadow.mjs";

import { browserPlan } from "./verify-agent-plan.mjs";

export function main(args) {
  const option = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const out = option("--out");
  if (!out) throw new Error("impact-shadow requires --out <path>");
  let result;
  if (args[0] === "plan") {
    const selection = affectedSpecs({ base: option("--base") });
    result = selectionSnapshot(selection, {
      sha: process.env.GITHUB_SHA ?? null,
      agent: selection ? browserPlan({ selection, record: durations() }) : null,
    });
  } else if (args[0] === "report") {
    const read = (file) => JSON.parse(readFileSync(file, "utf8"));
    const plan = option("--plan");
    const results = option("--results");
    if (!plan || !results) throw new Error("impact-shadow report requires --plan and --results");
    const retry = option("--retry");
    result = compareShadow(read(plan), read(results), {
      retryReport: retry && existsSync(retry) ? read(retry) : undefined,
      sha: process.env.GITHUB_SHA ?? null,
    });
    process.stdout.write(shadowSummary(result));
  } else throw new Error("impact-shadow expects plan or report");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`impact-shadow: ${error.message}\n`);
    process.exitCode = 1;
  }
}
