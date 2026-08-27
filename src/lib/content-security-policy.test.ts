import { describe, expect, it } from "vitest";
import {
  CSP_REPORT_PATH,
  enforcedPolicy,
  reportingEndpointsHeader,
  reportOnlyPolicy,
} from "./content-security-policy";

const base = { denyFraming: true } as const;

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
    // Media image hosts: AWS S3 and CloudFront.
    expect(imgSrc).toContain("https://*.s3.amazonaws.com");
    expect(imgSrc).toContain("https://*.s3.*.amazonaws.com");
    expect(imgSrc).toContain("https://*.cloudfront.net");
  });
});
