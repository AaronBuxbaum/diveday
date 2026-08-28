import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { GroupLabel, LedgerRow } from "@/components/ui/ledger";

/**
 * **A staff credential is a fact, never a badge and never a gate** — ADR
 * 20260827-the-shops-shelves, decision 3 ("credentials are a quiet ledger
 * beneath; renewal words, never gates — H-59").
 *
 * What this replaced was a two-column grid of cards, each carrying two pills:
 * a reviewed/needs-review state and, when the clock had run, an "Expired" or
 * "Due within 30 days" beside it. Two pills on every card spent the app's one
 * pill grammar on a row that is not exceptional, and a red chip on a lapsed
 * rating reads as a stop sign on a page whose whole contract is that it stops
 * nothing. So the state is a word in the row's own type: quiet for a
 * credential with nothing to say, warning ink for one inside its renewal
 * window or past it. The word is always there — the ink alone never carries
 * it.
 *
 * **Nothing here disables anything.** H-59 is that these clocks inform: a
 * lapsed rating never removes a person from the week above, never greys a
 * shift, never refuses an assignment. `StaffCredentials.test.tsx` asserts the
 * absence, because absence is the kind of rule that regresses quietly.
 *
 * Reading credentials stays owner/manager work, as it was before this slice —
 * the page renders the whole group only for them, so the change here is the
 * composition and nothing about who may see it.
 */

/** Where a credential's renewal date sits relative to the shop's own today. */
export type RenewalState = "not-recorded" | "current" | "due-soon" | "overdue";

export type CredentialRow = {
  id: string;
  /** "Keiko Tanaka · EFR Instructor" — the person and the credential, one line. */
  title: string;
  /**
   * The quiet half: the review state, the issuer, and the renewal date when
   * one is recorded — already joined into one sentence by the page.
   */
  detail: string;
  /** The renewal word, when the clock has something to say. Never colour alone. */
  renewalWord: string | null;
  renewal: RenewalState;
  /** Whether this row's own status flips to reviewed or back. */
  reviewed: boolean;
  reviewLabel: string;
};

/**
 * The whole group is owner/manager work — the page decides that once, so this
 * component has no `canManage` of its own to forget to check. It is rendered
 * or it is not.
 */
export function StaffCredentials({
  label,
  rows,
  words,
  reviewAction,
  deleteAction,
  door,
}: {
  label: string;
  rows: CredentialRow[];
  words: { saving: string; remove: string; removing: string };
  reviewAction: (formData: FormData) => void;
  deleteAction: (formData: FormData) => void;
  /** "+ Add a credential" — the group's own tail row, and its only door. */
  door: ReactNode;
}) {
  return (
    <section className="mt-10" aria-labelledby="credentials-heading">
      <GroupLabel as="h2" id="credentials-heading">
        {label}
      </GroupLabel>
      <ul className="mt-2">
        {rows.map((row) => (
          <LedgerRow key={row.id} stacked>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <p className="text-sm font-semibold">{row.title}</p>
              <p className="text-sm text-muted">{row.detail}</p>
              {/* The clock's word, in warning ink once it is inside the
                  window — and the word is what carries the state, so a
                  monochrome screen loses nothing. */}
              {row.renewalWord ? (
                <p
                  className={`text-sm font-medium ${
                    row.renewal === "current" ? "text-muted" : "text-warning-strong"
                  }`}
                >
                  {row.renewalWord}
                </p>
              ) : null}
            </div>
            {/* Both acts on every row, whatever the clock says. H-59: a
                credential inside its renewal window is not a row with fewer
                options than one comfortably ahead. */}
            <div className="mt-1 flex flex-wrap gap-2">
              <form action={reviewAction}>
                <input type="hidden" name="credentialId" value={row.id} />
                <input type="hidden" name="status" value={row.reviewed ? "pending" : "verified"} />
                <SubmitButton
                  pendingLabel={words.saving}
                  className={buttonClass({ variant: "ghost", size: "sm", className: "-ms-2" })}
                >
                  {row.reviewLabel}
                </SubmitButton>
              </form>
              <form action={deleteAction}>
                <input type="hidden" name="credentialId" value={row.id} />
                <SubmitButton
                  pendingLabel={words.removing}
                  className={buttonClass({ variant: "ghost", size: "sm" })}
                >
                  {words.remove}
                </SubmitButton>
              </form>
            </div>
          </LedgerRow>
        ))}
        {door}
      </ul>
    </section>
  );
}
