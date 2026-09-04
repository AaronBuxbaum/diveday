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
};

async function loadConfig(env: Record<string, string>): Promise<ImageConfig> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const module = await import(CONFIG);
  return module.default as ImageConfig;
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
