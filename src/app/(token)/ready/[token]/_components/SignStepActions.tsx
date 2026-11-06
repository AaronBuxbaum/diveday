import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";
import type { DiverChecklistItem } from "@/lib/readiness-summary";
import { openWaiverFromReady } from "../waiver-actions";
import { PhysicianDoor } from "./PhysicianDoor";

/**
 * **The thread's sign step: the release's act, and the course forms' door.**
 *
 * **The release signs here, on this link** (issue #2743): `openWaiverFromReady`
 * keeps the seat's release while it can still be signed, or starts a fresh one,
 * and opens it at `/ready/<token>/waiver`. No second link is handed over. A
 * lapsed release needs the same act as a pending one, so the only difference
 * is what the button promises. `guardian_signature_missing` belongs here too:
 * its own detail line tells the family to "grab a fresh link and sign it
 * together", and `openWaiverInThread` is ready for it (`alreadyStanding`
 * excludes a guardian-missing record, so signing from here supersedes the
 * solo signature and opens a release that asks for both).
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
        code === "waiver_lapsed" ||
        code === "waiver_runs_out" ||
        code === "guardian_signature_missing",
    );
  const formsOwed =
    courseFormsOwed ||
    (item?.actionable ?? []).some(
      (blocker) =>
        blocker.code === "course_form_unsigned" || blocker.code === "course_form_guardian_missing",
    );
  // Read off the same codes as the release's act: a referral waits on a physician.
  const awaitsPhysician = [item?.code, ...(item?.actionable ?? []).map((b) => b.code)].includes(
    "medical_review",
  );
  if (!waiverCode && !formsOwed && !awaitsPhysician) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {waiverCode ? (
        <form action={openWaiverFromReady.bind(null, token)}>
          <SubmitButton pendingLabel={t("words.busy.opening")} className={actionButton}>
            {t(
              waiverCode === "waiver_pending"
                ? "ready.signWaiver"
                : // Expired, lapsed and guardian-missing all end in the same act, and
                  // "Sign a fresh waiver" is what each one’s own copy has
                  // already told the reader to do.
                  "ready.freshWaiverLink",
            )}
          </SubmitButton>
        </form>
      ) : null}
      {/* A referred release's receipt carries the physician instructions and
          the doctor's page; the thread is where the diver signed it, so it is
          where they find it again. */}
      {awaitsPhysician && !waiverCode ? (
        <PhysicianDoor token={token} className={actionButton} t={t} />
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
