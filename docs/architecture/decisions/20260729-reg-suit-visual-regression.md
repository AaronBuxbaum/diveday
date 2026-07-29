# 20260729-reg-suit-visual-regression — Use reg-suit with S3 for visual regression

- **Status:** Accepted
- **Date:** 2026-07-29
- **Supersedes:** 20260729-backstop-visual-regression

## Context

We previously migrated from Playwright's `toHaveScreenshot()` to BackstopJS for visual regression testing (ADR `20260729-backstop-visual-regression`). However, BackstopJS was too slow, serializing visual comparisons within each scenario shard, and requiring complex scenario definitions. While Playwright raw screenshot assertions are fast, committing reference PNGs to the repository increases git repository bloat. We want a lightweight visual regression solution that does not require a hosted dashboard service (like Argos or Percy), keeps snapshot files out of the repository, but remains fully pullable/inspectable by MCP servers or AI agents using standard S3 storage.

## Decision

Use `reg-suit` with the `reg-publish-s3-plugin` and `reg-keygen-git-hash-plugin` for visual regression:

- Playwright tests run via `e2e/visual.spec.ts` and capture raw screenshots directly to `.reg/actual/` using `page.screenshot()`, running within the standard parallel worker fleet.
- `reg-suit` manages comparing the current screenshots against the parent git commit's baselines downloaded from AWS S3, generating an interactive HTML report, and publishing the actual screenshots back to S3.
- Infrastructure is managed via AWS CDK in TypeScript under the `infra/` directory (precompiled to JS on deployment).
- S3 configuration is set in `regconfig.json`, resolving the bucket name dynamically from the `$REG_S3_BUCKET_NAME` environment variable.
- Dev dependencies installed: `reg-suit`, `reg-publish-s3-plugin`, `reg-keygen-git-hash-plugin`, `aws-cdk`, `aws-cdk-lib`, and `constructs`.
- Add scripts to `package.json`:
  - `pnpm visual`: Runs Playwright visual screenshot generation followed by `reg-suit run`.
  - `pnpm infra:deploy`: Deploys the AWS CDK infrastructure stack (`InfraStack`) using `tsx` on-the-fly.
  - `pnpm infra:synth`: Synthesizes the CDK infrastructure template.
  - `pnpm infra:diff`: Compares local CDK modifications against deployed resources.

## Alternatives considered

- **Playwright native toHaveScreenshot():** Fast and simple, but commits visual baseline images to git, increasing repository size over time.
- **BackstopJS:** Rejected due to slow execution speed and complex configuration overhead.
- **Hosted visual dashboard (Argos/Percy):** Excluded to avoid hosting a separate dashboard service.

## Consequences

- **Git repository clean:** Visual baselines are stored externally in S3, avoiding repository size growth.
- **AWS S3 dependency:** Running the visual regression suite requires AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) and an S3 bucket configured via `$REG_S3_BUCKET_NAME`.
- **Fast runtimes:** Parallel screenshot capture in Playwright coupled with `reg-suit`'s fast image comparison engine ensures quick feedback loops.
