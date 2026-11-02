# 20261102-website-assist-public-suffix-list — Read the Public Suffix List with tldts for website assist

- **Status:** Accepted
- **Date:** 2026-11-02
- **Decided by:** Aaron, 2026-11-02 (#3642 row 18): use the already-transitive `tldts` list

## Context

A website assist restricts Claude's server-side `web_fetch` to the one host an owner pasted
(ADR 20261018-claude-assists). `allowed_domains` covers every subdomain of what it names, so a
pasted `co.uk` or `wixsite.com` would let the call read any tenant's pages under it. Until now
`src/lib/claude/web-fetch.ts` refused about 85 hand-picked registry and platform roots. Its own
comment said it was not the Public Suffix List, and the list was missing suffixes that are real
(`b.ck`, `com.ua`, `onrender.com`, `workers.dev`).

## Decision

Add `tldts` as a direct runtime dependency (`^7.4.19`, already in the lockfile through
`tough-cookie`, which `jsdom` pulls in for tests). `allowedFetchHost` refuses a host when
`parse(host, { allowPrivateDomains: true }).domain` is null, which means the host is itself a
public suffix: an ICANN registry, a wildcard suffix, or a hosted platform's shared root.

A short denylist stays in code for shared services that are not suffixes (`wix.com`,
`google.com`, `facebook.com` and eleven more). Everything else is unchanged: WHATWG URL parsing,
userinfo, port, IP and private-suffix refusal, the host kept exactly as pasted (`www.` included),
and `www.` dropped only for the check.

One decision changes on purpose. `www.b.ck` was accepted before and is refused now, because
dropping `www.` leaves `b.ck`, a wildcard suffix. Nobody has a website there. Unknown endings
behave as before (`bluereef.zzz` passes, `zzz` does not).

`web-fetch.test.ts` pins every root the old list refused, bare and with `www.`, so an upgrade of
`tldts` that dropped one fails the test and does not widen the allowance.

## Alternatives considered

- **Keep the hand-kept list** — it keeps missing real suffixes and has to be maintained by hand.
- **Parse the full host, `www.` included** — accepts `www.co.uk` and 63 other `www.<root>` forms the
  old guard refused.
- **A different parser (`psl`, `parse-domain`)** — one more package for the same data.

## Consequences

- The suffix data comes from the package version in `pnpm-lock.yaml`; a Renovate bump may refuse
  or accept a host. The test corpus is the guard for refusals.
- The package is MIT-licensed, has no runtime dependencies beyond `tldts-core`, and runs only in
  our process on a pasted string; it fetches nothing.
- Security-sensitive change (a tool allowlist): needs a `security-reviewer` run before merge.
