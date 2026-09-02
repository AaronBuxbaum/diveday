import { describe, expect, it } from "vitest";
import {
  CSP_REPORT_PATH,
  enforcedPolicy,
  reportingEndpointsHeader,
  reportOnlyPolicy,
} from "./content-security-policy";

const base = { denyFraming: true } as const;

/** Every optional host-adding switch on at once, so nothing escapes the sweep. */
const everyOption = {
  rumRegion: "us-east-1",
  mediaRegion: "us-east-1",
  metaSignup: true,
  development: true,
} as const;

/** The directives of one serialized policy, keyed by name. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((entry) => {
      const [name, ...sources] = entry.split(" ");
      return [name ?? "", sources];
    }),
  );
}

describe("the enforced half", () => {
  it("carries only the directives measured not to break anything", () => {
    // Deliberately an exact set, not a subset: the whole design is that this
    // header stays small until a deployed report-only pass says otherwise, and
    // a directive arriving here without that evidence is the mistake to catch
    // (issue #718). Growing it is a one-line change to this list, made
    // knowingly.
    expect([...directives(enforcedPolicy(base)).keys()]).toEqual([
      "object-src",
      "base-uri",
      "form-action",
      "frame-ancestors",
      "report-uri",
      "report-to",
    ]);
  });

  it("drops frame-ancestors, and only frame-ancestors, for an embed request", () => {
    const embed = directives(enforcedPolicy({ denyFraming: false }));
    expect(embed.has("frame-ancestors")).toBe(false);
    // The framing exception is about who may frame the page, never about
    // whether the page itself is guarded.
    expect(embed.get("object-src")).toEqual(["'none'"]);
    expect(embed.get("base-uri")).toEqual(["'self'"]);
  });

  it("reports its own violations, not only the report-only half's", () => {
    // A violation the enforced policy actually blocks is the one the ADR's
    // "worse than no CSP" warning is about, so it must be audible the same
    // way a report-only one is — not rehearsed, but real.
    const policy = directives(enforcedPolicy(base));
    expect(policy.get("report-uri")).toEqual([CSP_REPORT_PATH]);
    expect(policy.get("report-to")).toEqual(["csp"]);
  });

  it("lets a form reach Stripe's hosted pages", () => {
    // Paying from /ready and tipping from /recap are real form submits to a
    // Server Action that answers 303 to checkout.stripe.com, and browsers have
    // disagreed about whether form-action is re-checked across that redirect.
    const formAction = directives(enforcedPolicy(base)).get("form-action") ?? [];
    expect(formAction).toContain("'self'");
    expect(formAction).toContain("https://checkout.stripe.com");
    expect(formAction).toContain("https://connect.stripe.com");
  });
});

describe("the report-only half", () => {
  it("omits frame-ancestors, which a report-only policy may not carry", () => {
    // CSP2 specifies frame-ancestors as ignored in a report-only policy, so
    // including it would buy nothing and log a console warning per page view.
    expect(reportOnlyPolicy(base)).not.toContain("frame-ancestors");
  });

  it("names both reporting mechanisms, at the endpoint the route serves", () => {
    const policy = directives(reportOnlyPolicy(base));
    expect(policy.get("report-uri")).toEqual([CSP_REPORT_PATH]);
    // `report-to` names a group, and the group is defined by the companion
    // header — one without the other reports nowhere.
    expect(policy.get("report-to")).toEqual(["csp"]);
    expect(reportingEndpointsHeader()).toBe(`csp="${CSP_REPORT_PATH}"`);
  });

  it("frames the host Google's embed URL actually redirects to", () => {
    // maps.google.com 302s to www.google.com/maps/embed, and a frame
    // navigation re-checks the directive across that hop. Listing only the URL
    // src/lib/maps.ts writes would break /ready, the public trip page and the
    // dive-site editor at once while reading as correct.
    const frameSrc = directives(reportOnlyPolicy(base)).get("frame-src") ?? [];
    expect(frameSrc).toContain("https://maps.google.com");
    expect(frameSrc).toContain("https://www.google.com");
  });

  it("keeps eval out of production and allows it in development", () => {
    // React uses eval in development to rebuild server stacks in the browser.
    expect(reportOnlyPolicy(base)).not.toContain("'unsafe-eval'");
    expect(reportOnlyPolicy({ ...base, development: true })).toContain("'unsafe-eval'");
  });

  it("does not let Stripe be reached from the browser at all", () => {
    // Every Stripe call in this app is a server-side fetch, and Stripe.js is
    // never loaded — so a connect-src entry for Stripe would be widening the
    // policy for traffic that does not exist.
    // The exact list is pinned in "names none of them when RUM is not
    // configured"; this states the Stripe half separately because its reason is
    // different and a reader looking for Stripe should find it here.
    expect(directives(reportOnlyPolicy(base)).get("connect-src")).not.toContain(
      "https://api.stripe.com",
    );
  });

  describe("CloudWatch RUM's per-region hosts", () => {
    it("names the data plane and both credential hops", () => {
      const connect = directives(reportOnlyPolicy({ ...base, rumRegion: "eu-central-1" })).get(
        "connect-src",
      );
      expect(connect).toContain("https://dataplane.rum.eu-central-1.amazonaws.com");
      // Passing both an identity pool and a guest role selects aws-rum-web's
      // Cognito-then-STS flow, so the STS host is live and easy to miss.
      expect(connect).toContain("https://cognito-identity.eu-central-1.amazonaws.com");
      expect(connect).toContain("https://sts.eu-central-1.amazonaws.com");
    });

    it("names none of them when RUM is not configured", () => {
      // A deployment without telemetry gets a tighter policy, not a vaguer one.
      // Stated as the exact list rather than as an absence: an exact list also
      // says what IS there, so a host added without a reason fails here too.
      expect(directives(reportOnlyPolicy(base)).get("connect-src")).toEqual([
        "'self'",
        "https://va.vercel-scripts.com",
        "https://*.ingest.sentry.io",
        "https://*.ingest.us.sentry.io",
      ]);
    });

    it("refuses a region that is not a region", () => {
      // The value is interpolated straight into a header, so a malformed one
      // must not be able to introduce a second source or a second directive.
      const injected = reportOnlyPolicy({
        ...base,
        rumRegion: "eu-west-1; script-src *",
      });
      // A rejected region contributes nothing at all: neither a second
      // directive nor a host, so the policy is identical to the unconfigured
      // one. Compared whole rather than probed for a substring, which is both
      // stricter and not a thing that reads as URL sanitization.
      expect(injected).toEqual(reportOnlyPolicy(base));
    });
  });

  describe("the third-party script", () => {
    it("grants Meta's SDK only on the WhatsApp settings route", () => {
      // The only third-party script the product loads. It has no business
      // being loadable on the page where a diver pays.
      const off = directives(reportOnlyPolicy(base));
      expect(off.get("script-src")).not.toContain("https://connect.facebook.net");
      expect(off.get("connect-src")).not.toContain("https://graph.facebook.com");
      expect(off.get("frame-src")).not.toContain("https://www.facebook.com");

      const on = directives(reportOnlyPolicy({ ...base, metaSignup: true }));
      expect(on.get("script-src")).toContain("https://connect.facebook.net");
      expect(on.get("connect-src")).toContain("https://graph.facebook.com");
      expect(on.get("frame-src")).toContain("https://www.facebook.com");
    });
  });

  it("allows the image sources the app really uses", () => {
    const imgSrc = directives(reportOnlyPolicy(base)).get("img-src") ?? [];
    expect(imgSrc).toContain("'self'");
    // globals.css sets a background-image from a data: URI, which CSS resolves
    // against img-src rather than style-src.
    expect(imgSrc).toContain("data:");
    // Media image hosts: AWS S3 and CloudFront. The regional bucket form is a
    // function of `mediaRegion` rather than a second wildcard — this assertion
    // pinned `https://*.s3.*.amazonaws.com` until 2026-09-02, which is a source
    // expression every browser drops (issue #1263).
    expect(imgSrc).toContain("https://*.s3.amazonaws.com");
    expect(imgSrc).toContain("https://*.cloudfront.net");
  });
});

/**
 * A CSP host source may wildcard only the **leftmost** label: `*.example.com`
 * is legal, `a.*.example.com` is not, and a browser drops the whole source
 * silently apart from one console line. That is not a style rule — a dropped
 * source means the hosts it was meant to admit are blocked in production while
 * the policy still reads as if it covers them.
 *
 * It had already happened once. `img-src` carried `https://*.s3.*.amazonaws.com`
 * until 2026-09-02, so every regional bucket URL — the shape
 * `managedStorageOrigins` produces whenever `MEDIA_AWS_REGION` is set — was
 * admitted by nothing, while the legacy global-endpoint form kept matching the
 * neighbouring entry and hid it (issue #1263). `rumConnectHosts` had the rule
 * written down two hundred lines below the entry that broke it, which is
 * exactly why this is now a test rather than a comment.
 */
describe("every source is a legal source expression", () => {
  const policies = [
    ["enforced", enforcedPolicy(base)],
    ["report-only", reportOnlyPolicy(base)],
    ["report-only, every option on", reportOnlyPolicy({ ...base, ...everyOption })],
  ] as const;

  it.each(policies)("%s: wildcards only ever the leftmost label", (_name, policy) => {
    for (const [directive, sources] of directives(policy)) {
      for (const source of sources) {
        if (!source.includes("*")) continue;
        expect(
          source,
          `${directive} carries "${source}", whose wildcard is not the leftmost label — browsers drop the whole source`,
        ).toMatch(/^(?:[a-z]+:\/\/)?\*(?:\.[^*]+)?$/);
      }
    }
  });

  it.each(policies)("%s: no source can smuggle a second source or directive", (_name, policy) => {
    for (const [, sources] of directives(policy)) {
      for (const source of sources) {
        expect(source).not.toContain(";");
        expect(source).not.toContain(",");
        // `\s`, not `trim()`. `trim()` catches only the ends, and `directives`
        // splits on a literal space, so a plain space is invisible here by
        // construction — while an *internal* CR or LF, which is the character
        // class that actually splits a header, passes `trim()` untouched. No
        // source expression in this policy legitimately contains whitespace.
        expect(source).not.toMatch(/\s/);
      }
    }
  });

  it("admits the regional bucket host the storage adapter actually writes to", () => {
    const sources = directives(reportOnlyPolicy({ ...base, mediaRegion: "us-east-1" })).get(
      "img-src",
    );
    expect(sources).toContain("https://*.s3.us-east-1.amazonaws.com");
    // The legacy global endpoint stays admitted; objects written before the
    // regional form still resolve.
    expect(sources).toContain("https://*.s3.amazonaws.com");
  });

  it("adds no bucket host at all when no region is configured", () => {
    const sources = directives(reportOnlyPolicy(base)).get("img-src") ?? [];
    // The regional form only; the global endpoint needs no region and stays.
    expect(sources.filter((source) => /\.s3\.[a-z]+-[a-z]+-\d\./.test(source))).toEqual([]);
  });

  it("refuses a region that is not a plain AWS region label", () => {
    // Compared whole rather than probed for a substring, following the RUM
    // test above: a `some(...).includes("s3.us")` probe is fooled by case (it
    // would pass while the policy emitted `s3.US-EAST-1`), by a partial match,
    // and by the value landing in a directive other than the one being read.
    //
    // The CR/LF payloads are the header-splitting ones the concern is actually
    // about, and they are safe for a reason worth writing down: JavaScript's
    // `$` without the `m` flag asserts end of *input*, not end of line — unlike
    // Python and Ruby, where `$` also matches before a trailing newline. Port
    // this regex to one of those and `"us-east-1\n"` starts matching.
    for (const region of [
      "us-east-1 https://evil.example",
      "*",
      "; script-src *",
      "US-EAST-1",
      "us-east-1\nscript-src *",
      "us-east-1\r\nX-Injected: 1",
      " us-east-1",
    ]) {
      expect(reportOnlyPolicy({ ...base, mediaRegion: region })).toEqual(reportOnlyPolicy(base));
    }
  });
});
