# 20261102-postal-mime-inbound-reader — Use PostalMime to read inbound replies

- **Status:** Accepted
- **Date:** 2026-11-02
- **Supersedes:** the in-house MIME reader in decision 4 of [20260907-two-way-inbox](20260907-two-way-inbox.md), and its "a parsing dependency for MIME" alternative; the rest stands

## Context

`src/lib/inbound-email.ts` carried its own header unfolding, RFC 2047 decoding, transfer
encodings, charsets and multipart walk (issue #3238). The product owner directed on 2026-11-02 that
a maintained library replace in-house code unless review finds a major problem. The SNS, bucket,
tenant, sender-trust, size, reply-stripping and HTML policies stay the app's.

## Decision

Add `postal-mime` **4.2.0**, pinned exact: MIT-0, by Andris Reinman (`nodemailer`), from
`github.com/postalsys/postal-mime`, no runtime dependencies. `parseInboundEmail` wraps it and keeps every policy explicit:

- **Never rejects.** Over `MAX_INBOUND_MESSAGE_BYTES` (the S3 read still refuses first) or any
  throw is the empty record, which the route drops; only the error code is logged.
- **Tighter limits than the library's:** nesting 16, parts 1000, headers 256 KiB, and every
  `message/rfc822` an attachment (`forceRfc822Attachments`), so a forwarded message is a counted
  file and never read as the reply.
- **One sender or none.** Two `From:` headers (a spaced `From :` counts), two mailboxes, a group,
  or a header that does not spell the address the parser read give `from: null`. The route
  authenticates only when SES's own `commonHeaders.from` holds exactly one address equal to ours,
  then DMARC or SPF as before.
- **Threading headers are read raw.** `Message-ID` and `In-Reply-To` go back out in a staff
  reply, so they are never RFC 2047-decoded and are dropped if they hold a control character; the
  subject's are flattened to spaces.
- **Text, HTML fallback and reply stripping stay ours.** The library's `text` when a `text/plain`
  part exists, else our own `htmlToText` (linear, unterminated-tag safe), then `stripQuotedReply`;
  all inside the one `try`. NUL bytes are stripped where the row is written.

The library decodes and buffers attachment bytes and cannot skip them. Measured once, un-warmed:
a 2.2 MB reply with a 1.45 MB attachment took 157 ms and ~21 MB RSS (in-house 15 ms, ~7 MB); 900
small attachments 121 ms, 36 MB. Bounded by the 2 MiB cap and released on return, so accepted.
200,000 empty parts and 2 MB of quoted-printable got cheaper (in-house 92 and 126 MB).

## Alternatives considered

- **Keep the in-house reader** — the product owner's direction; no major problem was found.
- **`mailparser`** — the same author's stream parser with more dependencies; nothing we need.

## Consequences

Behavior changes, pinned in `inbound-email.test.ts`: every inline `text/plain` part is read
(previously the first), a calendar invite counts as a file, headerless input is read as a body,
and an over-limit tree is dropped rather than read to depth 8. A DMARC pass with no single `From:`
is no longer authenticated. Revisit if the library gains attachment skipping (use it) or if a
real reply is refused by a limit (raise that limit, not the cap).
