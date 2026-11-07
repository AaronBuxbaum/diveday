import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Every Action a workflow runs is pinned to a commit, with its version beside it.
 *
 * A tag is a pointer its owner can move. `corymhall/cdk-diff-action` ran on
 * `@v2` in the infra diff job, after `configure-aws-credentials` had put a role
 * into the environment that can write the CDK staging bucket a later deploy
 * reads; a moved tag (the tj-actions incident, March 2025) would have run
 * someone else's code with those credentials (2026-10-13 review, row 14).
 * A full commit SHA cannot be moved. The `# vX.Y.Z` comment is what a reader
 * and Dependabot's github-actions updates read to know what the SHA is.
 *
 * One exception: this repository's reg-suit publisher is called `@main`,
 * because its OIDC role trusts only that `job_workflow_ref` (issue #3274). A
 * pull request cannot move protected `main`, and a SHA it picks is exactly
 * what the role refuses.
 *
 * A local action (`./.github/actions/...`) is this repository's own code and is
 * exempt. Docker references are refused unless pinned by digest.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USES = /^\s*-?\s*uses:\s*(?<ref>[^\s#]+)\s*(?:#\s*(?<comment>.*))?$/u;
const PINNED = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/u;
const DOCKER_PINNED = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/u;
const VERSION_COMMENT = /^v\d+\.\d+\.\d+\b/u;
const REG_SUIT_PUBLISHER_ON_MAIN =
  "AaronBuxbaum/diveday/.github/workflows/reg-suit-publish.yml@main";

/**
 * The unpinned `uses:` lines in one file's text, as `file:line: why`.
 *
 * @param {string} file
 * @param {string} text
 * @returns {string[]}
 */
export function findUnpinnedActions(file, text) {
  const problems = [];
  for (const [index, line] of text.split("\n").entries()) {
    const match = USES.exec(line);
    if (!match?.groups) continue;
    const { ref, comment } = match.groups;
    const where = `${file}:${index + 1}`;
    if (ref.startsWith("./") || ref === REG_SUIT_PUBLISHER_ON_MAIN) continue;
    if (ref.startsWith("docker://")) {
      if (!DOCKER_PINNED.test(ref)) problems.push(`${where}: ${ref} is not pinned by digest`);
      continue;
    }
    if (!PINNED.test(ref)) {
      problems.push(`${where}: ${ref} is not pinned to a 40-character commit SHA`);
      continue;
    }
    if (!comment || !VERSION_COMMENT.test(comment.trim())) {
      problems.push(`${where}: ${ref} has no version comment`);
    }
  }
  return problems;
}

/** Workflow and composite-action files under `.github/`. */
function workflowFiles(dir = path.join(ROOT, ".github")) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...workflowFiles(full));
    else if (/\.ya?ml$/u.test(entry) && entry !== "dependabot.yml") found.push(full);
  }
  return found;
}

// Imported by the test, which must not read the tree or exit the process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = workflowFiles();
  const problems = files.flatMap((full) =>
    findUnpinnedActions(path.relative(ROOT, full), readFileSync(full, "utf8")),
  );
  if (problems.length > 0) {
    console.error("action-pins: a workflow runs an Action by a tag its owner can move:");
    console.error(problems.map((line) => `- ${line}`).join("\n"));
    console.error(
      "\nPin it to the commit the tag points at, with the version as a comment: `uses: owner/repo@<40-hex sha> # v1.2.3`. Only `AaronBuxbaum/diveday/.github/workflows/reg-suit-publish.yml@main` is exempt (its OIDC role trusts that ref alone, #3274). `git ls-remote --tags https://github.com/owner/repo` lists tags.",
    );
    process.exit(1);
  }
  console.log(
    `action-pins: ${files.length} workflow files; every third-party Action is pinned to a commit`,
  );
}
