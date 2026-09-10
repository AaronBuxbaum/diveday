import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **No cookie this app sets may carry a `Domain` attribute.**
 *
 * A cookie set without `Domain` is *host-only*: the browser returns it to
 * `dive.day` and to nothing else. Add `Domain=.dive.day` — or turn on a
 * framework switch that adds it for you — and the same cookie is returned to
 * every subdomain, on every request, including subresource requests for images.
 *
 * This was previously an invariant nobody had to hold, because it was
 * structural. Media was served from `d111111abcdef8.cloudfront.net`, and
 * `cloudfront.net` is on the Public Suffix List, so no cookie policy expressible
 * anywhere could have sent a DiveDay cookie there. Serving media from
 * `media.dive.day` instead (`mediaDomainName`, `infra/lib/infra-stack.ts` S11b)
 * trades that structural isolation for a configuration one: the media host is
 * now the same registrable domain as the app, so a domain-scoped session cookie
 * would be attached to **every image request on every page**, and would reach a
 * CloudFront edge that logs nothing we read and that we do not control the
 * caching of.
 *
 * The `__Secure-` prefix does not save us here — only `__Host-` forbids a
 * `Domain`, and better-auth's session cookie uses `__Secure-`. So the invariant
 * is asserted rather than assumed, and this test is the whole of the assertion:
 * a future `www.` or marketing subdomain that reaches for
 * `crossSubDomainCookies` fails here first, with this docblock as the reason.
 *
 * Written as a source scan rather than a runtime assertion deliberately. The
 * dangerous change is a single configuration line, not a code path, and a
 * runtime test only sees the cookies a test happens to exercise.
 */

const SOURCE_ROOT = path.join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    found.push(full);
  }
  return found;
}

/** The argument text of every `…cookies.set(` call, one entry per call site. */
function cookieSetArguments(source: string): string[] {
  const calls: string[] = [];
  const marker = /\bcookies\s*\.\s*set\s*\(/g;
  for (const match of source.matchAll(marker)) {
    let depth = 1;
    let cursor = (match.index ?? 0) + match[0].length;
    const start = cursor;
    while (cursor < source.length && depth > 0) {
      const char = source[cursor];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      cursor += 1;
    }
    calls.push(source.slice(start, cursor - 1));
  }
  return calls;
}

describe("cookie scope", () => {
  it("sets no cookie with a Domain attribute, anywhere in src", () => {
    let callSites = 0;
    for (const file of sourceFiles(SOURCE_ROOT)) {
      for (const args of cookieSetArguments(readFileSync(file, "utf8"))) {
        callSites += 1;
        expect(
          args,
          `${path.relative(process.cwd(), file)} sets a cookie with a Domain attribute`,
        ).not.toMatch(/\bdomain\s*:/i);
      }
    }
    // A scan that found nothing would pass while proving nothing — the failure
    // mode of every test that reads its own source tree. `res.cookies.set` is
    // how the proxy remembers a buddy referral and a partner referral; if this
    // ever reads zero, the call shape moved and this test needs to move with it.
    expect(
      callSites,
      "no cookies.set call sites found — has the call shape changed?",
    ).toBeGreaterThan(0);
  });

  it("does not ask better-auth to widen the session cookie past this host", () => {
    const auth = readFileSync(path.join(SOURCE_ROOT, "lib/auth.ts"), "utf8");
    // The three better-auth knobs that would add a `Domain` to the session
    // cookie. None is present today; the `advanced` block carries only
    // `database.generateId` and `useSecureCookies`.
    for (const knob of ["crossSubDomainCookies", "cookieDomain", "defaultCookieAttributes"]) {
      expect(auth, `src/lib/auth.ts sets ${knob}`).not.toContain(knob);
    }
    // The read is only meaningful if it found the config at all.
    expect(auth).toContain("useSecureCookies");
  });
});
