# 20261115-online-logbook-file-interchange — Use explicit beta file interchange for online logbooks

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

Aaron requested online-logbook imports including Oceanic+, PADI and SSI, with unverified
compatibility labelled beta. Personal computer evidence must remain separate from operational
dives and retain the existing live tenant, role, erasure and idempotency boundaries.

Official sources establish [Oceanic+ UDDF](https://www.oceanicworldwide.com/faqs/),
[Shearwater XML/UDDF](https://shearwater.com/pages/shearwater-cloud),
[Subsurface interchange](https://subsurface-divelog.org/subsurface-user-manual/) and
[Suunto FIT exports](https://www.suunto.com/Support/faq-articles/suunto-app/what-type-of-files-can-i-export-from-the-suunto-app/).
These statements do not verify our parser against every vendor's exports.
[Garmin's personal API](https://developer.garmin.com/gc-developer-program/personal/personal-faq/)
excludes commercial multi-user applications; [Suunto's partner API](https://apizone.suunto.com/)
requires review. SSI's documented [SCUBAPRO integration](https://www.divessi.com/en/blog/blog/blog/scubapro-logtrak-myssi-app-integration-10251.html)
does not establish a general third-party API or CSV schema. No PADI export schema has been verified.

## Decision

Offer a provider chooser as user-declared beta provenance, independently of content-detected
format. PADI and SSI guidance describes manual transfer or an independently obtained file, without
claiming either exports CSV. Do not solicit credentials, use private APIs or show unauthorised
connection flows.

Accept explicit CSV column/date/unit mappings alongside the labelled DiveDay template. Preserve
calendar-only dates without fabricating midnight, a timezone or an instant. Native template units
remain intrinsic even inside an archive with mapped generic CSV files.

Read bounded ZIPs in memory, validate paths, flags, sizes, CRCs and entry structure, reject nested
archives, and parse supported entries before confirmation. Discard raw files. Store chosen-source,
mapping and archive provenance in the existing personal record. Exclude transport metadata from
exact identity; calendar-only records without source IDs use underlying file identity and row
ordinal. Review possible duplicates without silently merging them.

Provide an authorised, formula-escaped summary CSV alongside the complete JSON backup. Summary
CSV deliberately omits profiles and gases. Every path uses the existing scoped live authorization
and lifecycle locks. No schema change or dependency is required.

## Alternatives considered

- **Direct vendor connections** — require an established public contract and approved partner access.
- **Guess generic CSV units or dates** — risks manufacturing evidence from ambiguous inputs.
- **Retain uploaded archives** — adds sensitive storage without helping the confirmation workflow.

## Consequences

File preview works without credentials and exposes uncertainty. Vendor compatibility remains beta;
synthetic fixtures prove format behavior, while the existing Garmin fixture proves only its stated
Descent/Connect scope. Partner approval or representative licensed exports would justify revisiting
individual adapters. Future adapters can preserve personal records and add provenance rather than
migrating operational dives.
