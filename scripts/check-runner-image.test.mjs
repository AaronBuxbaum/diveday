import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  findCacheKeyDrift,
  findRunnerDrift,
  PLAYWRIGHT_CACHE_ACTION,
  RUNNER_IMAGE,
  RUNNER_PICK,
} from "./check-runner-image.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function repoWorkflows() {
  const dir = path.join(ROOT, ".github/workflows");
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => [`.github/workflows/${name}`, readFileSync(path.join(dir, name), "utf8")]);
}

describe("findRunnerDrift", () => {
  it("passes the tree as it stands", () => {
    expect(findRunnerDrift(repoWorkflows())).toEqual([]);
  });

  it("refuses ubuntu-latest, naming the file and line", () => {
    const text = "jobs:\n  build:\n    runs-on: ubuntu-latest\n";
    expect(findRunnerDrift([["ci.yml", text]])).toEqual([
      `ci.yml:3 runs on \`ubuntu-latest\`; every job runs on \`${RUNNER_IMAGE}\`.`,
    ]);
  });

  it("refuses another pinned image too: moving is one deliberate change", () => {
    expect(findRunnerDrift([["a.yml", "    runs-on: ubuntu-26.04\n"]])).toHaveLength(1);
  });

  it("leaves alone the pinned label, quoted or with a trailing comment, and a commented line", () => {
    const text = [
      `    runs-on: ${RUNNER_IMAGE}`,
      `    runs-on: "${RUNNER_IMAGE}"`,
      `    runs-on: ${RUNNER_IMAGE} # pinned`,
      "    # runs-on: ubuntu-latest was here",
    ].join("\n");
    expect(findRunnerDrift([["a.yml", text]])).toEqual([]);
  });
});

describe("the runner pick", () => {
  it("passes the Mac-or-GitHub pick that falls back to the image", () => {
    expect(findRunnerDrift([["ci.yml", `    runs-on: ${RUNNER_PICK}\n`]])).toEqual([]);
  });

  it("refuses a pick that falls back to a moving label", () => {
    const text = `    runs-on: ${RUNNER_PICK.replace(RUNNER_IMAGE, "ubuntu-latest")}\n`;
    expect(findRunnerDrift([["ci.yml", text]])).toHaveLength(1);
  });

  it("answers the image when it picks GitHub", async () => {
    const { GITHUB_HOSTED } = await import("./ci-runner-pick.mjs");
    expect(GITHUB_HOSTED).toBe(RUNNER_IMAGE);
  });
});

describe("findCacheKeyDrift", () => {
  const action = readFileSync(path.join(ROOT, PLAYWRIGHT_CACHE_ACTION), "utf8");

  it("passes the action as it stands", () => {
    expect(findCacheKeyDrift(action)).toEqual([]);
  });

  it("refuses a key that names only runner.os", () => {
    const old = action.replace("${{ steps.image.outputs.os }}", "${{ runner.os }}");
    expect(findCacheKeyDrift(old)).toHaveLength(1);
  });

  it("refuses a missing action", () => {
    expect(findCacheKeyDrift(undefined)).toHaveLength(1);
  });
});
