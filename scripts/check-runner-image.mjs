import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Every CI job runs on one named runner image, and the Playwright cache knows
 * which one.
 *
 * `ubuntu-latest` is a moving label. From 2026-10-19 GitHub moves it to Ubuntu
 * 26, gradually, so for days one run's eight visual shards and two consecutive
 * main commits can land on different images. Every visual baseline is rendered
 * on 24.04, and a different FreeType, HarfBuzz, fallback font set or system
 * Chromium (`playwright.config.ts` prefers `/usr/bin/chromium`) is a pixel diff
 * on hundreds of captures that no code caused. The notice sat on every job of
 * run 4761; nothing here read it (code review 2026-10-13, row 6).
 *
 * So the image is named, once, here, and moving to the next one is a single
 * pull request that changes `RUNNER_IMAGE`, does what this guard says, and
 * rebaselines on purpose (ADR 20260730-linux-ci-runners, amendment
 * 2026-10-13).
 *
 * Two rules:
 *
 * 1. Every `runs-on:` in `.github/workflows/` says `RUNNER_IMAGE`.
 * 2. The Playwright browser cache key names the image (`ImageOS`), not just
 *    `runner.os`, which says only "Linux": a browser downloaded on one image
 *    must not be restored onto the next.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The one runner image every job runs on. */
export const RUNNER_IMAGE = "ubuntu-24.04";

export const PLAYWRIGHT_CACHE_ACTION = ".github/actions/playwright-shell/action.yml";

/** Each `runs-on:` that is not the pinned image, as `file:line runs on label`. */
export function findRunnerDrift(workflows) {
  const drift = [];
  for (const [file, text] of workflows) {
    text.split("\n").forEach((line, index) => {
      const match = line.match(/^\s*runs-on:\s*(.+?)\s*(?:#.*)?$/);
      if (!match) return;
      const label = match[1].replace(/^["']|["']$/g, "");
      if (label !== RUNNER_IMAGE) {
        drift.push(
          `${file}:${index + 1} runs on \`${label}\`; every job runs on \`${RUNNER_IMAGE}\`.`,
        );
      }
    });
  }
  return drift;
}

/** The cache key of the Playwright action must name the runner image. */
export function findCacheKeyDrift(actionText) {
  if (actionText === undefined) {
    return [`${PLAYWRIGHT_CACHE_ACTION} is missing; this guard cannot check its cache key.`];
  }
  const key = actionText.match(/^\s*key:\s*(.+)$/m)?.[1];
  if (key === undefined) return [`${PLAYWRIGHT_CACHE_ACTION} has no cache \`key:\`.`];
  if (!key.includes("steps.image.outputs.os") || !actionText.includes("${ImageOS")) {
    return [
      `${PLAYWRIGHT_CACHE_ACTION}'s cache key is \`${key}\`. It must name the runner image (\`ImageOS\`, through the \`image\` step), or a browser downloaded on one image is restored onto the next.`,
    ];
  }
  return [];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.join(ROOT, ".github/workflows");
  const names = (await readdir(dir)).filter((name) => /\.ya?ml$/.test(name)).sort();
  const workflows = await Promise.all(
    names.map(async (name) => [
      `.github/workflows/${name}`,
      await readFile(path.join(dir, name), "utf8"),
    ]),
  );
  const action = await readFile(path.join(ROOT, PLAYWRIGHT_CACHE_ACTION), "utf8").catch(
    () => undefined,
  );
  const problems = [...findRunnerDrift(workflows), ...findCacheKeyDrift(action)];
  if (problems.length > 0) {
    console.error("CI is not pinned to one runner image:");
    console.error(problems.map((p) => `- ${p}`).join("\n"));
    console.error(
      `\nA moving label renders the visual baselines on whichever image GitHub hands out. Pin \`runs-on: ${RUNNER_IMAGE}\`; to move images, change RUNNER_IMAGE in scripts/check-runner-image.mjs in one pull request that rebaselines on purpose.`,
    );
    process.exit(1);
  }
  console.log(
    `runner-image: ${workflows.length} workflows run on ${RUNNER_IMAGE}, and the Playwright cache key names the image`,
  );
}
