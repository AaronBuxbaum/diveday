# Evidence signing key history

Waiver and course-form seals protect their existing versioned field sets. Key identity is separate
from that field version: tagged hashes are `hmac-sha256:<key-id>:<digest>` in the existing text
column. The key ID is authenticated by the digest. Deploying the code alone does not change any
secret, re-seal any row, or switch an existing installation to tagged hashes.

## Before changing keys

Inventory `waiver_records.integrity_hash`, `course_form_records.integrity_hash`, and
`waiver_seal_acknowledgements.state_digest` in a read-only query. Count untagged 64-character hashes and each tagged key ID; do not export signed
fields or secrets. Check the existing integrity-verdict counts and preserve this baseline.
An already-invalid row must not become valid just because a key is rotated.

Identify the exact key that made untagged records: `WAIVER_INTEGRITY_SECRET` if configured when
signed, otherwise the original `AUTH_SECRET`. A changed current secret cannot recover a lost one.
Do not infer the historical key from a variable's current name or rotate authentication first.

## Routine rotation

1. Store a new independently generated secret in the approved secret manager, not in a shell
   command, log, ticket, or this repository. New registry keys require at least 32 characters.
2. Configure `WAIVER_INTEGRITY_KEYS` as JSON with `active` (one stable key ID) and `keys` (an object
   from IDs to secrets). IDs contain only letters, digits, underscores or hyphens, up to 48
   characters. `legacy` is reserved for verifying untagged hashes and cannot be active.
3. When first opting in, retain the exact original untagged key under `keys.legacy`. Its original
   length is preserved, not upgraded by padding. Retain every previous tagged key under its
   original ID. A key ID must never be reused for a different secret.
4. Validate in an isolated environment: known signed and erased waivers and course forms must
   verify, while changed fields, unknown IDs and restored erased fields must fail. Check that new
   evidence has the intended active ID. Compare verdict counts before and after.
5. Deploy the configuration through the normal authorized process. Verify the nightly seal check
   and representative old/new records. Never bulk re-seal history to make a rollout appear green.

An unconfigured registry keeps the existing untagged signing behavior. Once tagged seals exist,
removing the registry makes those seals unverifiable. Roll back by restoring the previous registry,
not by clearing it. Malformed registry configuration refuses new signing and verifies no seals;
there is no fallback to authentication secrets in that state.

## Compromise or key loss

Removing a key ID rejects every seal carrying that ID. Removing `legacy` rejects untagged seals.
This is a conscious incident decision, not routine cleanup. Retaining a compromised secret permits
verification but no longer proves provenance; an HMAC is not an independent notarization service.
Preserve incident records and affected key-ID counts. Do not re-seal affected history to hide the
loss of trust. Escalate the legal/evidence response to the owner before deleting retained keys.

Current-media version recovery and evidence-record retention are separate policies. This feature
neither deletes signed records nor changes incident holds or the medical-readiness rules.
