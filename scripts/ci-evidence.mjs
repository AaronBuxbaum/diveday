// Job outcomes are facts; root causes remain unknown without diagnostic evidence.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

// `repo-safeguards` runs Lint, Typecheck and check:repo as steps of one job (ci.yml, 2026-10-24).
const REPRO = {
  "repo-safeguards": "pnpm lint && pnpm typecheck && pnpm check:repo",
};
export function failureGroups(jobs, annotations) {
  const groups = new Map();
  for (const job of jobs.filter((item) => item.conclusion === "failure")) {
    const failedSteps =
      job.steps?.filter((step) => step.conclusion === "failure").map((step) => step.name) ?? [];
    const items = annotations
      .filter((item) => item.job === job.name)
      .flatMap((item) => (Array.isArray(item.items) ? item.items : []));
    const excerpts = items.map((item) => String(item.message ?? "").slice(0, 2000));
    const setup = failedSteps.find((name) => /install|setup|download|restore|checkout/i.test(name));
    const signature = setup
      ? `setup:${setup}`
      : `${failedSteps.join("|")}:${excerpts[0] ?? "no diagnostic"}`;
    const files = [
      ...new Set(
        items
          .map((item) => item.path)
          .filter(
            (file) =>
              typeof file === "string" &&
              !file.split("/").includes("..") &&
              existsSync(file) &&
              /^(src|scripts|e2e)\/[\w/.-]+\.(?:test\.(?:ts|tsx|mjs)|spec\.ts)$/.test(file),
          ),
      ),
    ];
    const reproduction = files.length
      ? files.every((file) => file.startsWith("e2e/"))
        ? { command: "pnpm", args: ["e2e:run", ...files] }
        : files.every((file) => !file.startsWith("e2e/"))
          ? { command: "pnpm", args: ["exec", "vitest", "run", ...files] }
          : null
      : null;
    if (!groups.has(signature))
      groups.set(signature, {
        signature,
        classification: setup
          ? "setup-step-failure"
          : files.length
            ? "test-diagnostic"
            : "unclassified",
        rootCause: null,
        jobs: [],
        excerpts,
        files,
        reproduction,
        nextAction: reproduction
          ? "Run the named reproduction after the required build/setup."
          : "Open the linked failed job and its artifacts to identify a focused reproduction.",
      });
    groups.get(signature).jobs.push(job.name);
  }
  return [...groups.values()];
}
export function evidenceManifest({
  needs = {},
  jobs = [],
  annotations = [],
  artifacts = [],
  env = {},
}) {
  return {
    version: 1,
    failureGroups: failureGroups(jobs, annotations),
    sha: env.GITHUB_SHA ?? null,
    headSha: env.PR_HEAD_SHA || env.GITHUB_SHA || null,
    baseSha: env.PR_BASE_SHA || null,
    runId: env.GITHUB_RUN_ID ?? null,
    attempt: env.GITHUB_RUN_ATTEMPT ?? null,
    url: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    jobs: Object.entries(needs).map(([id, job]) => ({
      id,
      result: job.result,
      reproduction: REPRO[id] ?? null,
      classification: ["failure", "cancelled"].includes(job.result) ? "unclassified" : null,
    })),
    attempts: jobs.map((job) => ({
      id: job.id,
      name: job.name,
      conclusion: job.conclusion,
      url: job.html_url,
      startedAt: job.started_at ?? null,
      completedAt: job.completed_at ?? null,
      steps:
        job.steps?.map((step) => ({
          name: step.name,
          conclusion: step.conclusion,
          startedAt: step.started_at ?? null,
          completedAt: step.completed_at ?? null,
        })) ?? [],
      failedSteps:
        job.steps?.filter((step) => step.conclusion === "failure").map((step) => step.name) ?? [],
    })),
    annotations,
    artifacts: artifacts.map((item) => ({
      name: item.name,
      url: item.archive_download_url,
      expired: item.expired,
    })),
    limitations: [
      "Job conclusions do not establish root cause or flakiness. Inspect failed steps, annotations and test artifacts before classifying.",
      "Missing API evidence is explicit; no successful result is inferred from an unavailable report.",
    ],
  };
}
function main() {
  const env = process.env;
  const read = (endpoint) => {
    try {
      return JSON.parse(
        readBounded("gh", ["api", endpoint], {
          encoding: "utf8",
          timeoutMs: SUBPROCESS_TIMEOUTS.ghHookRead,
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
    } catch {
      return null;
    }
  };
  const prefix = `repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const jobs = read(`${prefix}/attempts/${env.GITHUB_RUN_ATTEMPT}/jobs?per_page=100`);
  const artifacts = read(`${prefix}/artifacts?per_page=100`);
  const annotations = [];
  for (const job of (jobs?.jobs ?? []).filter((job) => job.conclusion === "failure").slice(0, 12)) {
    if (job.conclusion !== "failure") continue;
    const check = job.check_run_url?.split("/check-runs/")[1];
    if (check)
      annotations.push({
        job: job.name,
        items: read(`repos/${env.GITHUB_REPOSITORY}/check-runs/${check}/annotations?per_page=100`),
      });
  }
  const manifest = evidenceManifest({
    needs: JSON.parse(env.CI_NEEDS || "{}"),
    jobs: jobs?.jobs,
    annotations,
    artifacts: artifacts?.artifacts,
    env,
  });
  manifest.missingEvidence = [
    ...(!jobs ? ["job API unavailable"] : []),
    ...(!artifacts ? ["artifact API unavailable"] : []),
    ...annotations
      .filter((item) => item.items === null)
      .map((item) => `annotations unavailable: ${item.job}`),
  ];
  manifest.truncated = Boolean(
    annotations.some((item) => item.items?.length === 100) ||
      jobs?.total_count > 100 ||
      artifacts?.total_count > 100 ||
      (jobs?.jobs ?? []).filter((job) => job.conclusion === "failure").length > 12,
  );
  mkdirSync(".agent-out", { recursive: true });
  writeFileSync(".agent-out/ci-result.json", `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("CI evidence: .agent-out/ci-result.json");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
