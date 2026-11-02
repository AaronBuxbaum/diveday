# 20261102-public-suffix-list — Use tldts for website-assist suffix refusal

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

A website assist gives Claude's `web_fetch` tool `allowed_domains: [host]`, and that allowance
covers every subdomain, so a pasted registry or builder root (`co.uk`, `wixsite.com`) would let one
call read any tenant under it (ADR [20261018-claude-assists](20261018-claude-assists.md), security
review N4). `src/lib/claude/web-fetch.ts` refused 77 hand-picked roots and missed every
other suffix, wildcard rules such as `*.ck` and `*.kawasaki.jp` included. Issue #3338; Aaron chose
the Public Suffix List on 2026-11-02.

## Decision

`tldts` 7.4.19 (exact pin) becomes a direct runtime dependency. It was already in the tree through
`tough-cookie`. `allowedFetchHost` keeps WHATWG URL parsing, the http(s), userinfo, port, IP,
label and private-name checks, then sets one leading `www.` aside and refuses the rest when
`getDomain(host, { allowPrivateDomains: true })` finds no registrable domain (the host is itself a
suffix, ICANN or private section, wildcards and exceptions applied) or when it is in
`SHARED_SERVICE_ROOTS`: ordinary domains that host many unrelated sites but are not suffixes
(`wix.com`, `facebook.com`, `sites.google.com`). The returned host is still exactly what was pasted.

Intentional changes, each pinned with a comment in `web-fetch.test.ts`: `b.ck`, `www.b.ck`,
`foo.kawasaki.jp`, `s3.amazonaws.com` and `appspot.com` are now refused, and so are the
special-use names `.example`, `.onion`, `.alt` and `.arpa`. Every host refused before is still
refused; the test walks the whole former list, so a list release that drops a platform fails
there.

Provenance: npm `tldts`, MIT, sole maintainer Rémi Berson (`remusao`), source
github.com/remusao/tldts; it compiles the Public Suffix List into its own `tldts-core`. Used only
on the server (`src/db/website-setup.ts`).

## Alternatives considered

- **Keep the hand list** — misses every suffix nobody thought to add, and goes stale silently.
- **Judge the full host, `www.` included** — keeps `www.b.ck` but accepts `www.co.uk` and the other
  `www.` + root hosts the old guard refused.
- **`psl` or `parse-domain`** — another copy of the same list where `tldts` is already installed.

## Consequences

The suffix list moves with Dependabot updates to `tldts`; a release can add or remove a suffix, so
the former-roots test is the tripwire, and a dropped platform moves to `SHARED_SERVICE_ROOTS`. A
shop whose site is `www.<wildcard suffix>` must paste the bare host. To leave, restore a hand list
in `isSharedRoot`; nothing else depends on the package.
