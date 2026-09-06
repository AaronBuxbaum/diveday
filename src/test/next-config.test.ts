import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **The image optimizer's allowlist, guarded where it is actually configured**
 * (issue #1358).
 *
 * `managedImageRemotePatterns` has its own tests, and they were green through
 * the entire life of the defect they now describe — because the defect was
 * never in a function. It was three literals in `next.config.ts`, and nothing
 * in this repository read that file. A future edit that appends
 * `{ hostname: "*.cloudfront.net" }` beside the derived list would leave
 * `src/lib/storage/index.test.ts` passing and `pnpm check:repo` silent.
 *
 * So this reads the config object itself. It is the only test that does, and
 * the import is by absolute path because the file sits outside the `@/` alias.
 */
const CONFIG = path.join(process.cwd(), "next.config.ts");

type ImageConfig = {
  images?: {
    remotePatterns?: { hostname?: string; protocol?: string; pathname?: string }[];
    domains?: string[];
  };
  assetPrefix?: string;
  outputFileTracingExcludes?: Record<string, string[]>;
};

async function loadConfig(env: Record<string, string>): Promise<ImageConfig> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const module = await import(CONFIG);
  return module.default as ImageConfig;
}

async function loadPreviewFlag(env: Record<string, string>): Promise<boolean> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const module = (await import(CONFIG)) as { isVercelPreviewBuild: boolean };
  return module.isVercelPreviewBuild;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const CONFIGURED = {
  MEDIA_PUBLIC_URL_BASE: "https://d111111abcdef8.cloudfront.net",
  MEDIA_BUCKET_NAME: "diveday-media",
  MEDIA_AWS_REGION: "us-east-1",
};

describe("next.config.ts images", () => {
  /**
   * The finding itself. A pattern is matched by hostname through picomatch, so
   * a `*` anywhere in one is an open image proxy: `/_next/image` downloads,
   * decodes, re-encodes and serves whatever it is pointed at, to anybody with a
   * URL and no account.
   */
  it("allows no wildcard host, on a fully configured deployment", async () => {
    const config = await loadConfig(CONFIGURED);
    const patterns = config.images?.remotePatterns ?? [];
    expect(patterns.length, "expected the configured origins to produce patterns").toBe(3);
    for (const pattern of patterns) {
      expect(pattern.hostname).toBeTruthy();
      expect(pattern.hostname).not.toContain("*");
      expect(pattern.protocol).toBe("https");
    }
    expect(patterns.map((pattern) => pattern.hostname)).toContain("d111111abcdef8.cloudfront.net");
  });

  /**
   * **`domains` is ORed with `remotePatterns`**, not intersected
   * (`next/dist/shared/lib/match-remote-pattern.js`), so one entry there
   * bypasses everything above. It is deprecated and unset; this is what keeps
   * it unset.
   */
  it("carries no legacy `domains` list, which would bypass the patterns", async () => {
    const config = await loadConfig(CONFIGURED);
    expect(config.images?.domains).toBeUndefined();
  });

  /**
   * Next pushes `assetPrefix`'s host into `remotePatterns` itself, with no
   * `pathname` — so setting one silently allowlists a whole origin over `**`
   * from a line that says nothing about images
   * (`next/dist/server/config.js`). Not set today, and this says so out loud
   * rather than leaving the next reader to find it in Next's source.
   */
  it("sets no assetPrefix, which Next would allowlist without saying so", async () => {
    const config = await loadConfig(CONFIGURED);
    expect(config.assetPrefix).toBeFalsy();
  });

  /**
   * An empty allowlist is a closed one — Next's default is `[]` and
   * `hasRemoteMatch([], [], url)` is false — so a developer with no media
   * configured gets "not allowed" rather than "allow everything".
   */
  it("allows nothing at all when no media storage is configured", async () => {
    const config = await loadConfig({
      MEDIA_PUBLIC_URL_BASE: "",
      MEDIA_BUCKET_NAME: "",
      MEDIA_AWS_REGION: "",
    });
    expect(config.images?.remotePatterns).toEqual([]);
  });
});

/**
 * The flag that keeps Sentry's source-map generation on the one build whose
 * maps anybody reads. `SENTRY_AUTH_TOKEN` is Production-only on Vercel
 * (docs/engineering/monitoring-runbook.md), so a preview never uploaded a map
 * and never deleted one either — it generated 173 MB of them and shipped them.
 *
 * What these pin is the *narrowness*: "not production" alone would also catch a
 * developer's `pnpm build` and CI's `e2e:build`, changing two builds this was
 * never about.
 */
describe("next.config.ts isVercelPreviewBuild", () => {
  it("is true for a Vercel preview build", async () => {
    expect(await loadPreviewFlag({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe(true);
  });

  it("is false for the Vercel production build, which owns the maps", async () => {
    expect(await loadPreviewFlag({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(false);
  });

  it("is false off Vercel, so a local build and CI keep the behaviour they had", async () => {
    expect(await loadPreviewFlag({ VERCEL: "", VERCEL_ENV: "" })).toBe(false);
    expect(await loadPreviewFlag({ VERCEL: "", VERCEL_ENV: "preview" })).toBe(false);
  });
});

/**
 * **The globs that currently match nothing, and must survive somebody noticing
 * that** (issue #1370).
 *
 * `sharp` ships one libvips build per platform, and until 52e62f1 this repo's
 * `pnpm-workspace.yaml` forced all four onto every install — which is what the
 * "37.2 MB off every traced function" in `next.config.ts` was measured against.
 * Without that key an install matches its machine, so on the Linux x64 boxes CI
 * and Vercel build on, `@img/*-darwin-*` is never installed and never traced.
 * Re-measured 2026-09-06: zero darwin paths in any of 147 closures.
 *
 * That makes the four darwin globs look like dead configuration, and deleting
 * dead configuration is the correct instinct almost everywhere. Here it is the
 * one wrong turn: they are insurance for a build on a Mac, the machine where
 * those packages *do* install, and their cost is nothing. A number in a comment
 * cannot stop that edit; this can.
 */
describe("next.config.ts outputFileTracingExcludes", () => {
  it("keeps the darwin sharp globs, which are insurance rather than a saving", async () => {
    const config = await loadConfig(CONFIGURED);
    const globs = config.outputFileTracingExcludes?.["**"] ?? [];
    for (const glob of [
      "node_modules/.pnpm/@img+sharp-darwin-*/**",
      "node_modules/.pnpm/@img+sharp-libvips-darwin-*/**",
      "node_modules/@img/sharp-darwin-*/**",
      "node_modules/@img/sharp-libvips-darwin-*/**",
    ]) {
      expect(
        globs,
        `${glob} matches nothing on a Linux install by design — it is what keeps a Mac build from shipping an unreachable native. See the comment above outputFileTracingExcludes.`,
      ).toContain(glob);
    }
  });

  it("keeps the linux native traced, since it is the one that actually runs", async () => {
    const config = await loadConfig(CONFIGURED);
    const globs = config.outputFileTracingExcludes?.["**"] ?? [];
    // Excluding this is the failure the darwin exclusion is carefully not:
    // a function that cannot decode a JPEG.
    expect(globs.some((glob) => glob.includes("linux"))).toBe(false);
  });
});
