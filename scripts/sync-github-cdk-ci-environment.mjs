#!/usr/bin/env node
// Creates or updates the infra-deploy GitHub Environment that
// GitHubActionsCdkDeployRole's OIDC trust condition names (infra-stack.ts
// §18): required reviewer = the gh CLI's currently authenticated user, which
// is who ran `pnpm infra:deploy` and answered "yes" to this prompt. Re-running
// this is how you add a second reviewer later (edit the reviewers array by
// hand in GitHub -- this script only ever asserts "the current user is one of
// them", it does not remove anyone else's approval right).
import { execFileSync } from "node:child_process";

const ENVIRONMENT_NAME = "infra-deploy";

function gh(arguments_, options = {}) {
  return execFileSync("gh", arguments_, { encoding: "utf8", ...options }).trim();
}

const repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
const reviewerId = Number(gh(["api", "user", "--jq", ".id"]));
if (!Number.isInteger(reviewerId)) {
  console.error(
    "sync-github-cdk-ci-environment: could not resolve the gh CLI's authenticated user id.",
  );
  process.exit(1);
}

const body = JSON.stringify({
  wait_timer: 0,
  prevent_self_review: false,
  reviewers: [{ type: "User", id: reviewerId }],
  deployment_branch_policy: null,
});

gh(["api", "--method", "PUT", `repos/${repo}/environments/${ENVIRONMENT_NAME}`, "--input", "-"], {
  input: body,
});

console.log(
  `${ENVIRONMENT_NAME} GitHub Environment ready on ${repo}, with user id ${reviewerId} as a required reviewer.`,
);
