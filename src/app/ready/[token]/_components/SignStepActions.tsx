import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";
import type { DiverChecklistItem } from "@/lib/readiness-summary";
import { signWaiverFromReady } from "../actions";

/**
 * **The thread's sign step: the release's act, and the course forms' door.**
 *
 * An expired link needs the same action as a pending one —
 * `signWaiverFromReady` always issues a fresh link and opens it, superseding
 * whatever came before, so the only difference is what the button promises.
 * Naming it matters: "Sign your waiver" on a link the diver already knows is
 * dead reads as the page not having noticed. `guardian_signature_missing`
 * belongs here for the same reason `waiver_expired` does: its own detail line
 * tells the family to "grab a fresh link and sign it together", and
 * `issueWaiverRequest` is ready for it (`alreadyStanding` excludes a
 * guardian-missing record, so signing from here supersedes the solo signature
 * and mints a link that asks for both).
 *
 * The release's code is read off every blocker the diver can act on in this
 * step rather than only its headline: a course form owed beside an unsigned
 * release must not hide the release's button (ADR 20261008-course-forms).
 *
 * **The forms door opens on what is owed, not only on what blocks** (issue
 * #2266). With `COURSE_FORMS_BLOCK_BOARDING` at warn-only, readiness never
 * raises `course_form_unsigned`, and the door drawn only from that blocker
 * left the send's direct link as the one way in. `courseFormsOwed` is the
 * enrollment's own outstanding list, read whatever the switch says.
 */
export function SignStepActions({
  token,
  item,
  courseFormsOwed,
  actionButton,
  t,
}: {
  token: string;
  item: DiverChecklistItem | undefined;
  /** This enrollment still owes a course form, blocking or not. */
  courseFormsOwed: boolean;
  actionButton: string;
  t: DiverTranslator;
}) {
  const waiverCode = [item?.code, ...(item?.actionable ?? []).map((b) => b.code)]
    .filter((code) => code !== undefined)
    .find(
      (code) =>
        code === "waiver_pending" ||
        code === "waiver_expired" ||
        code === "guardian_signature_missing",
    );
  const formsOwed =
    courseFormsOwed ||
    (item?.actionable ?? []).some(
      (blocker) =>
        blocker.code === "course_form_unsigned" || blocker.code === "course_form_guardian_missing",
    );
  if (!waiverCode && !formsOwed) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {waiverCode ? (
        <form action={signWaiverFromReady.bind(null, token)}>
          <SubmitButton pendingLabel={t("ready.opening")} className={actionButton}>
            {t(
              waiverCode === "waiver_pending"
                ? "ready.signWaiver"
                : // Expired and guardian-missing both end in the same act, and
                  // "Get a fresh waiver link" is what each one's own copy has
                  // already told the reader to do.
                  "ready.freshWaiverLink",
            )}
          </SubmitButton>
        </form>
      ) : null}
      {/* The course's forms are signed on this link's own sub-page: they
          belong to this enrollment, which is exactly what the readiness link
          proves. Second to the release when both are owed — the release is
          the one the shop leads with. */}
      {formsOwed ? (
        <Link
          href={`/ready/${token}/forms`}
          prefetch={false}
          className={waiverCode ? buttonClass({ variant: "secondary", size: "sm" }) : actionButton}
        >
          {t("ready.signCourseForms")}
        </Link>
      ) : null}
    </div>
  );
}
