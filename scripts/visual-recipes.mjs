#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const recipes = JSON.parse(
  readFileSync(new URL("../docs/design/recipes/index.json", import.meta.url), "utf8"),
);
const recipe = recipes[process.argv[2]];
if (!recipe) {
  console.error(`Choose a recipe: ${Object.keys(recipes).join(", ")}`);
  process.exitCode = 2;
} else {
  console.log(JSON.stringify(recipe, null, 2));
  if (!process.argv.includes("--plan")) {
    const result = runBounded("pnpm", recipe.testArgs, {
      stdio: "inherit",
      timeoutMs: SUBPROCESS_TIMEOUTS.verifyPushStep,
    });
    process.exitCode = result.status ?? 1;
  }
}
