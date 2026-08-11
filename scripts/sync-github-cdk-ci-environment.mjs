#!/usr/bin/env node
// Creates or updates the infra-deploy GitHub Environment that
// GitHubActionsCdkDeployRole's OIDC trust condition names (infra-stack.ts
// §18): required reviewer = the gh CLI's currently authenticated user. On a
// workstation that is who ran `pnpm infra:deploy` and answered "yes" to this
// prompt. In the CI-unattended run (ADR 20260811-ci-deploy-full-wizard) it is
// instead whoever the INFRA_DEPLOY_GH_TOKEN PAT belongs to -- not necessarily
// the human who approved that specific deploy run -- so every run of this
// script logs the exact user id it adds (see the final console.log below);
// nothing here is silent about which identity became a required reviewer.
//
// GitHub's environment-update endpoint takes `reviewers` as the full desired
// state, not a delta -- a naive unconditional PUT would silently drop a
// second reviewer (a teammate, a break-glass account) a human added by hand
// after the fact, the next time anyone re-ran this. So this reads the
// environment first (GET) and only ever *adds* the current user to whatever
// reviewer list already exists; it never removes an entry it didn't add.
// wait_timer/prevent_self_review are carried forward unchanged from an
// existing environment. deployment_branch_policy is set to "main only" on
// first creation -- otherwise cdk deploy could run from any branch a
// workflow_dispatch happened to target, defeating the point of gating
// production changes behind the environment approval at all -- and left
// alone on every later run, so a human's own branch-policy change here
// survives a re-run of this script.
import { execFileSync } from "node:child_process";

const ENVIRONMENT_NAME = "infra-deploy";

function gh(arguments_, options = {}) {
  return execFileSync("gh", arguments_, { encoding: "utf8", ...options }).trim();
}

function ghJson(arguments_, options = {}) {
  return JSON.parse(gh(arguments_, options));
}

function existingEnvironment(repo) {
  try {
    return ghJson(["api", `repos/${repo}/environments/${ENVIRONMENT_NAME}`]);
  } catch (error) {
    // Only a genuine 404 (no environment yet) is a reason to create one from
    // scratch. Any other failure -- auth, network, a renamed endpoint -- must
    // not be swallowed into "doesn't exist", which is exactly the path that
    // would silently overwrite a real, already-configured environment.
    const stderr = error.stderr?.toString() ?? "";
    if (/HTTP 404|Not Found/.test(stderr)) return null;
    throw error;
  }
}

const repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
const reviewerId = Number(gh(["api", "user", "--jq", ".id"]));
if (!Number.isInteger(reviewerId)) {
  console.error(
    "sync-github-cdk-ci-environment: could not resolve the gh CLI's authenticated user id.",
  );
  process.exit(1);
}

const existing = existingEnvironment(repo);
const existingReviewers = (
  existing?.protection_rules?.find((rule) => rule.type === "required_reviewers")?.reviewers ?? []
).map((entry) => ({ type: entry.type, id: entry.reviewer.id }));
const alreadyIncluded = existingReviewers.some(
  (reviewer) => reviewer.type === "User" && reviewer.id === reviewerId,
);
const reviewers = alreadyIncluded
  ? existingReviewers
  : [...existingReviewers, { type: "User", id: reviewerId }];

const body = JSON.stringify({
  wait_timer: existing?.wait_timer ?? 0,
  prevent_self_review: existing?.prevent_self_review ?? false,
  reviewers,
  deployment_branch_policy: existing
    ? existing.deployment_branch_policy
    : { protected_branches: false, custom_branch_policies: true },
});

gh(["api", "--method", "PUT", `repos/${repo}/environments/${ENVIRONMENT_NAME}`, "--input", "-"], {
  input: body,
});

if (!existing) {
  // custom_branch_policies:true above accepts deploys from nothing until at
  // least one policy is registered -- not protected_branches:true, because
  // that depends on `main` separately having branch protection turned on,
  // and silently allowing zero branches to deploy is a worse failure than a
  // clearly-named policy would be.
  gh([
    "api",
    "--method",
    "POST",
    `repos/${repo}/environments/${ENVIRONMENT_NAME}/deployment-branch-policies`,
    "-f",
    "name=main",
  ]);
}

console.log(
  `${ENVIRONMENT_NAME} GitHub Environment ready on ${repo}, with user id ${reviewerId} among its ${reviewers.length} required reviewer(s).`,
);
