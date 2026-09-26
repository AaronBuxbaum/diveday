/**
 * The decisions `scripts/migrate-region.mjs` makes before it deletes anything,
 * as pure functions.
 *
 * A module of its own because the script runs on import -- it signs in and
 * reads the account the moment it loads -- and because one of these answers a
 * question the script's own tests cannot reach by driving it: every region
 * constant names us-east-1 today, so "mail stays in the region being left" is
 * a state no `--from` can produce while the refusal of a `--from` equal to
 * PRIMARY_REGION stands in front of it.
 */

/**
 * Whether the email stack is leaving `oldRegion` along with the main one.
 *
 * When SES_REGION is the region being left, mail is staying put: the email
 * stack there is live, owns `diveday-inbound-mail`, and holds a production-
 * access grant that took weeks. Nothing about a PRIMARY_REGION move entitles
 * the migration to touch it.
 */
export function mailLeavesWithTheEstate({ oldRegion, sesRegion }) {
  return sesRegion !== oldRegion;
}

/**
 * The region a `get-bucket-location` answer means.
 *
 * S3 answers `null` (or an empty string) for us-east-1, and the legacy `EU`
 * for eu-west-1 buckets created before the region had a name. Anything else is
 * the region itself. `undefined` means the answer carried no constraint field
 * at all, which is not a region: it comes back `null` so the caller treats the
 * bucket as "could not tell" rather than as us-east-1.
 */
export function regionFromLocationConstraint(constraint) {
  if (constraint === undefined) return null;
  if (constraint === null || constraint === "") return "us-east-1";
  if (constraint === "EU") return "eu-west-1";
  return constraint;
}

/**
 * Why a create failed, when the answer is "try again in a few minutes".
 *
 * Two of them, and both are AWS's global view of a bucket catching up with a
 * delete that already happened:
 *
 * - `bucket-name`: S3 frees a deleted bucket's name minutes after the delete.
 *   `head-bucket` answers 404 while `create-bucket` answers 409
 *   OperationAborted, "A conflicting conditional operation is currently in
 *   progress against this resource".
 * - `ses-bucket-region`: SES checks that the inbound bucket is in its own
 *   region, and for a while after the bucket moved it still sees the old one:
 *   "Could not publish to bucket diveday-inbound-mail. Your bucket must be in
 *   the same region as your Amazon SES configuration." (2026-09-26.)
 *
 * `null` for anything else, which is a real failure and is never retried.
 */
export function settlingKind(reasons) {
  if (reasons.some((reason) => reason.includes("same region as your Amazon SES"))) {
    return "ses-bucket-region";
  }
  if (
    reasons.some(
      (reason) =>
        reason.includes("conflicting conditional operation") || reason.includes("OperationAborted"),
    )
  ) {
    return "bucket-name";
  }
  return null;
}
