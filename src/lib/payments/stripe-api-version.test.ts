import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  STRIPE_EVENT_FIXTURES,
  STRIPE_FIXTURE_API_VERSION,
  STRIPE_FIXTURE_DIR,
  STRIPE_OBJECT_FIXTURES,
  stripeEventFixture,
} from "./__fixtures__/stripe";

/**
 * The guard that makes the pinned Stripe API version *visible*, and keeps a
 * bump from landing without a fixture re-capture.
 *
 * A fixture set that is not pinned to a version is only a snapshot of
 * someone's memory: it drifts, silently, and the tests it feeds stay green
 * while the shape it claims to prove stops being true. So the version is
 * written down exactly once (`STRIPE_FIXTURE_API_VERSION`) and everything that
 * could disagree with it is checked here — the directory the payloads live in,
 * the `api_version` Stripe stamps on every event, and any version the
 * production code pins.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Stripe's version format: a release date, optionally with its codename. */
const STRIPE_VERSION_PATTERN = /\d{4}-\d{2}-\d{2}(?:\.[a-z]+)?/;

/**
 * Every way a Stripe API version can be pinned from code: the wire header, the
 * SDK constructor option, and the env var an operator might reach for. Matching
 * any of them means the repo has an opinion about the version, and that opinion
 * has to agree with these fixtures.
 */
const VERSION_PIN_PATTERN = /["'`]?Stripe-Version["'`]?|\bapiVersion\b|\bSTRIPE_API_VERSION\b/i;

/** The production source that talks to Stripe — tests and fixtures excluded. */
function stripeSourceFiles(): string[] {
  const roots = [
    path.join(REPO_ROOT, "src/lib/payments"),
    path.join(REPO_ROOT, "src/app/api/webhooks/stripe"),
  ];
  const files: string[] = [];
  for (const root of roots) {
    for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      if (entry.name.includes(".test.")) continue;
      const full = path.join(entry.parentPath, entry.name);
      // The fixtures name the version on purpose; they are the thing being
      // checked, not a pin to check against.
      if (full.includes("__fixtures__")) continue;
      files.push(full);
    }
  }
  return files;
}

/** One file's source, as the scanners below take it. */
type SourceFile = { file: string; body: string };

function readSources(): SourceFile[] {
  return stripeSourceFiles().map((file) => ({
    file: path.relative(REPO_ROOT, file),
    body: readFileSync(file, "utf8"),
  }));
}

/**
 * Files that pin a Stripe API version in any of the three ways code can.
 *
 * A pure function of its input, deliberately: the whole point of this guard is
 * that it fires when a pin diverges from the fixtures, and the only honest way
 * to show it fires is to hand it a file that diverges. Reading the repo is one
 * caller of this; the synthetic cases below are the others, and they are what
 * make "this guard can go red" a demonstrated fact rather than a claim.
 */
/**
 * Source with comments removed.
 *
 * A comment that *names* `Stripe-Version` is documentation about the pin —
 * usually the sentence explaining that this repo deliberately has none — and
 * treating it as a pin makes the guard fire on its own explanation. That is
 * not hypothetical: `invoicing.ts` grew exactly such a comment while
 * explaining why it accepts two Invoice shapes, and reddened this test.
 *
 * Deliberately crude (it does not know a `//` inside a string literal from a
 * real comment), because the alternative is parsing TypeScript to answer a
 * question about grep. The failure mode of the crudeness is a *missed* pin
 * inside a string containing `//`, and there is no such string here — every
 * genuine pin below is a header key, an SDK option, or an env var.
 */
function withoutComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function filesPinningAVersion(sources: readonly SourceFile[]): string[] {
  return sources
    .filter(({ body }) => VERSION_PIN_PATTERN.test(withoutComments(body)))
    .map(({ file }) => file);
}

/**
 * Every Stripe-shaped version string in these files that is **not** the one the
 * fixtures were captured under. Empty means code and fixtures agree.
 */
function versionDisagreements(
  sources: readonly SourceFile[],
): Array<{ file: string; version: string }> {
  const found: Array<{ file: string; version: string }> = [];
  for (const { file, body } of sources) {
    for (const version of body.match(new RegExp(STRIPE_VERSION_PATTERN, "g")) ?? []) {
      if (version !== STRIPE_FIXTURE_API_VERSION) found.push({ file, version });
    }
  }
  return found;
}

describe("the fixtures are pinned to one API version", () => {
  it("keeps the payloads in a directory named for the version they were captured under", () => {
    // The directory name *is* how every individual file names its version —
    // Stripe stamps no version on a bare object, only on an Event.
    expect(path.basename(STRIPE_FIXTURE_DIR)).toBe(STRIPE_FIXTURE_API_VERSION);
    expect(existsSync(STRIPE_FIXTURE_DIR)).toBe(true);
  });

  it("stamps every event with the same api_version the directory claims", () => {
    // A real Stripe event carries the version it was rendered at. A fixture
    // copied forward from an older capture shows up right here rather than as
    // a mysteriously-passing contract test.
    for (const name of STRIPE_EVENT_FIXTURES) {
      expect(stripeEventFixture(name).api_version, `${name}.json`).toBe(STRIPE_FIXTURE_API_VERSION);
    }
  });

  it("lists exactly the files that exist, in both directions", () => {
    // A fixture added to disk but not to the loader is a payload no test can
    // reach; one listed but deleted is a loader that throws at import.
    const onDisk = (kind: "objects" | "events") =>
      readdirSync(path.join(STRIPE_FIXTURE_DIR, kind))
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.replace(/\.json$/, ""))
        .sort();

    expect(onDisk("objects")).toEqual([...STRIPE_OBJECT_FIXTURES].sort());
    expect(onDisk("events")).toEqual([...STRIPE_EVENT_FIXTURES].sort());
  });

  it("names a version Stripe could actually serve", () => {
    expect(STRIPE_FIXTURE_API_VERSION).toMatch(new RegExp(`^${STRIPE_VERSION_PATTERN.source}$`));
  });
});

describe("the code's pinned version and the fixtures' cannot diverge", () => {
  /**
   * Today this finds nothing, and that is the finding.
   *
   * No call in `src/lib/payments/` sends a `Stripe-Version` header — every one
   * hits `https://api.stripe.com/v1/...` with only `Authorization`,
   * `Content-Type`, `Stripe-Account` and `Idempotency-Key`. Stripe therefore
   * answers at whatever version the platform account's **dashboard** is set to,
   * and delivers webhooks at whatever version each **endpoint** is set to. Both
   * are changeable by a human in a browser: no deploy, no diff, no review — and
   * the shapes below stop being true with nothing in this repo any the wiser.
   *
   * So this test states the absence out loud instead of leaving it implicit. The
   * moment anyone adds a pin, it goes red and points at these fixtures, which is
   * exactly the reconciliation a version change should force.
   */
  it("has no version pin in the payments code — and says so, so adding one forces a re-capture", () => {
    expect(
      filesPinningAVersion(readSources()),
      "A Stripe API version is now pinned in the payments code. Reconcile it with " +
        `STRIPE_FIXTURE_API_VERSION (${STRIPE_FIXTURE_API_VERSION}) and re-capture the fixtures — ` +
        "see src/lib/payments/__fixtures__/stripe/README.md.",
    ).toEqual([]);
  });

  /**
   * The other half of the same guard, and the one that survives the pin being
   * added: wherever a version string turns up in the payments code, it must be
   * the fixtures'. Written as a rule rather than as a hypothetical so it is
   * already in place when someone pins one.
   */
  it("agrees with every Stripe-shaped version string the payments code does contain", () => {
    expect(versionDisagreements(readSources())).toEqual([]);
  });

  /**
   * **Proof the two guards above can actually go red.**
   *
   * Both currently pass by finding nothing, which is exactly how a guard rots:
   * a scanner with a broken pattern, a wrong root, or an accidentally-empty file
   * list is indistinguishable from a clean repo, and stays "green" forever while
   * proving nothing. A pin only appears when someone adds one to production
   * source, and this is a testing change that must not.
   *
   * So the detectors are pure functions and these cases feed them a file that
   * *does* diverge. If the scanning logic ever stops working, these fail — and
   * the day someone really pins a version, the guards above are known to be
   * capable of catching it.
   */
  describe("the guards fire on a divergent pin (synthetic sources)", () => {
    const OLDER = "2025-03-31.basil";

    it("flags a Stripe-Version header pinned to another version", () => {
      const sources = [
        { file: "src/lib/payments/fake.ts", body: `headers: { "Stripe-Version": "${OLDER}" }` },
      ];
      expect(filesPinningAVersion(sources)).toEqual(["src/lib/payments/fake.ts"]);
      expect(versionDisagreements(sources)).toEqual([
        { file: "src/lib/payments/fake.ts", version: OLDER },
      ]);
    });

    it("flags the SDK's apiVersion option and the env-var spelling too", () => {
      expect(
        filesPinningAVersion([
          { file: "a.ts", body: `new Stripe(key, { apiVersion: "${OLDER}" })` },
        ]),
      ).toEqual(["a.ts"]);
      expect(
        filesPinningAVersion([{ file: "b.ts", body: "process.env.STRIPE_API_VERSION" }]),
      ).toEqual(["b.ts"]);
    });

    it("stays silent when the pinned version IS the fixtures' version", () => {
      // The other direction, so the guard cannot pass by flagging everything:
      // a pin that agrees with the fixtures is the state we *want* and must not
      // be reported as a disagreement.
      const agreeing = [
        {
          file: "c.ts",
          body: `headers: { "Stripe-Version": "${STRIPE_FIXTURE_API_VERSION}" }`,
        },
      ];
      expect(versionDisagreements(agreeing)).toEqual([]);
      // It is still a pin, though — that half is about *existence*, not agreement.
      expect(filesPinningAVersion(agreeing)).toEqual(["c.ts"]);
    });

    it("does not mistake an ordinary date for a Stripe version pin", () => {
      // `STRIPE_VERSION_PATTERN` matches a bare date, so a comment mentioning
      // one would disagree. Worth knowing which way that cuts: it is caught,
      // deliberately — a stray date in payments code is either a version or
      // something that should not be pattern-matched as one.
      expect(versionDisagreements([{ file: "d.ts", body: "// shipped 2026-01-02" }])).toEqual([
        { file: "d.ts", version: "2026-01-02" },
      ]);
      // …but it is not a *pin*, so the first guard leaves it alone.
      expect(filesPinningAVersion([{ file: "d.ts", body: "// shipped 2026-01-02" }])).toEqual([]);
    });
  });
});
