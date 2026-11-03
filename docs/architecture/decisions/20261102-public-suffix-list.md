# 20261102-public-suffix-list — Refuse wildcard parents, unknown TLDs and shared roots too

- **Status:** Accepted
- **Date:** 2026-11-02
- **Amends:** [20261102-website-assist-public-suffix-list](20261102-website-assist-public-suffix-list.md)

## Context

A website assist gives Claude's `web_fetch` tool `allowed_domains: [host]`, and that allowance
covers every subdomain, so a pasted registry or builder root (`co.uk`, `wixsite.com`) would let one
call read any tenant under it (ADR [20261018-claude-assists](20261018-claude-assists.md), security
review N4). `src/lib/claude/web-fetch.ts` refused 77 hand-picked roots and missed every
other suffix, wildcard rules such as `*.ck` and `*.kawasaki.jp` included. Issue #3338; Aaron chose
the Public Suffix List on 2026-11-02.

## Decision

[20261102-website-assist-public-suffix-list](20261102-website-assist-public-suffix-list.md) added
`tldts` (`^7.4.19`) as a direct dependency and refuses a host that is itself a public suffix. This
decision, from an independent security review, tightens that rule. `allowedFetchHost` keeps WHATWG URL parsing, the http(s), userinfo, port, IP,
label and private-name checks, then sets one leading `www.` aside and refuses the rest when
`tldts` (`allowPrivateDomains: true`) finds no registrable domain (the host is itself a suffix),
when the host's TLD is in neither section of the list (`intranet.corp`), when `a.<host>` has no
registrable domain (the parent of a wildcard rule: `sch.uk`, `kobe.jp`), or when it is in
`SHARED_SERVICE_ROOTS`: ordinary domains that host many unrelated sites or files but are not
suffixes (`wix.com`, `facebook.com`, `raw.githubusercontent.com`). The returned host is still
exactly what was pasted.

Intentional changes, each pinned with a comment in `web-fetch.test.ts`: wildcard suffixes and
their parents (`b.ck`, `www.b.ck`, `foo.kawasaki.jp`, `kawasaki.jp`, `sch.uk`), private platform
suffixes (`s3.amazonaws.com`, `compute-1.amazonaws.com`), any unknown TLD, `m.facebook.com`, and
the special-use names `.example`, `.onion`, `.alt` and `.arpa` are now refused. Every host
refused before is still refused; the test walks the whole former list, so a list release that
drops a platform fails there. An independent security review set the parent, unknown-TLD and
service rules.

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
shop whose site is `www.<wildcard suffix>` must paste the bare host, and one on a TLD newer than
the installed list is refused until `tldts` is updated. To leave, restore a hand list
in `isSharedRoot`; nothing else depends on the package.
