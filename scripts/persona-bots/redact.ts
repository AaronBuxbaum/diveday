import { redactCapabilityUrl } from "../../src/lib/capability-urls";

/**
 * Capability URLs taken out of free text, by the app's own redactor.
 *
 * **Everything a persona walk records is on its way into a public issue.** Rob
 * stands on `/ready/<token>` and `/waivers/<token>`, where the URL *is* the
 * capability ([capability-telemetry-runbook.md](../../docs/engineering/capability-telemetry-runbook.md)),
 * and a Playwright message, a console line or a refused request from there
 * carries the token in its prose. A bot that published one would be handing out
 * a signing link.
 *
 * The `url` field of a finding is one whole URL and goes straight through
 * `redactCapabilityUrl`. This is for the other half — the evidence, where a URL
 * is one token inside a sentence. It finds the URL-shaped runs and hands each
 * to that same function, rather than reimplementing it: an earlier version was
 * a local regex over `CAPABILITY_ROUTE_PREFIXES`, which looked equivalent and
 * was strictly weaker, missing a percent-encoded prefix
 * (`/%72eset-password/…`) and every `CAPABILITY_QUERY_PARAMS` value
 * (`?booking=`, `?handoff=`, `?gate=`). One reachable path made that concrete:
 * `bookAndSign` waits on `toHaveURL(/\/ready\//)`, and on timeout Playwright's
 * message quotes the URL it did get — which would have been fenced verbatim
 * into an issue body, at the severity that files first.
 *
 * Delegating means the two can never diverge again, and it inherits the
 * property that matters: `CAPABILITY_ROUTE_PREFIXES` is derived from the
 * `src/app/<prefix>/[token]` directories on disk and asserted against them by
 * `src/app/observability.test.ts`, so a new capability route is covered here the
 * day it is added.
 */

/**
 * A URL-shaped run inside prose: an absolute URL, or a path beginning at `/`.
 * Stops at whitespace and at the punctuation that ends a URL in a sentence, a
 * quoted string, a Markdown link or a code fence.
 */
const URL_SHAPED = /https?:\/\/[^\s"'`)\]<>]+|\/[^\s"'`)\]<>]*/g;

export function redactCapabilityText(text: string): string {
  return String(text ?? "").replace(URL_SHAPED, (match) => {
    const redacted = redactCapabilityUrl(match);
    // `redactCapabilityUrl` fails closed on something it cannot parse. Here
    // that means the run was not a URL after all — a fragment of prose that
    // happened to start with a slash — so the original text is kept rather
    // than replaced with the redactor's placeholder.
    return redacted === "[unparseable]" ? match : redacted;
  });
}
