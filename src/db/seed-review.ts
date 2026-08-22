import { nowDate } from "@/lib/clock";

/**
 * **Who checked this card, and when** — the stamp every seeded *verified*
 * certification carries.
 *
 * The columns have always existed and the app has always written them: a
 * staffer tapping "Mark certified" reaches `reviewCertification`, which records
 * `reviewedByPersonId` from their own session. The seed never did, so every
 * carded diver in the demo read back as "Certified — reviewer not recorded" on
 * the departure log — the page a shop reaches for when something has gone wrong
 * and the one place the question is actually asked (issue #625). The product
 * looked as though it did not capture the answer; it captured it everywhere
 * except the data anyone ever looks at.
 *
 * **Three kinds of card deliberately get nothing from here**, and they are the
 * reason this is a helper rather than a column default:
 *
 * - **`pending`** — nobody has reviewed it yet. That is the whole state.
 * - **`importedAt` set** — a CSV import is not a review. `reviewedAt` stays
 *   null so `importedAt IS NOT NULL AND reviewedAt IS NULL` keeps naming the
 *   confirm nudge, which is the pair `certifications.importedAt`'s own comment
 *   describes.
 * - **`selfDeclaredAt` set** — the diver's word, reviewed by no one.
 */
export function reviewedBy(personId: string): {
  reviewedAt: Date;
  reviewedByPersonId: string;
} {
  // **`nowDate()`, never `nextCreatedAt()`.** That helper is a shared monotonic
  // counter handed out to break insertion-order ties, and a review date needs
  // no tie broken — but calling it ~90 more times shifts the `createdAt` of
  // every seeded row *after* each call, which moved 60 visual baselines on the
  // first run of this change for reasons that had nothing to do with reviewers.
  // One frozen instant keeps the diff to the sentence that actually changed.
  return { reviewedAt: nowDate(), reviewedByPersonId: personId };
}
