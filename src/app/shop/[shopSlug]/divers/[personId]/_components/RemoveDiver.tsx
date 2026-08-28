import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { deletePersonAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile } from "./shared";

export function RemoveDiver({
  diver,
  shopSlug,
  personId,
  t,
  status,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  t: StaffTranslator;
  /** This act's own outcome — a permission refusal stays with its control. */
  status?: DiverNotice;
}) {
  return (
    /* No heading of its own: "Delete" above a disclosure that already says
       "Delete Adaeze Nwosu" named the same act twice, and the second telling
       was the one with the diver's name in it. The disclosure summary is this
       act's own label, and it sits in the record's quiet foot with the other
       things you do *to* a record rather than with it.

       Opened by its own outcome: a refusal rendered inside a shut disclosure is
       invisible, which is worse than page-top. */
    <details open={Boolean(status)} className="scroll-mt-24" id="remove">
      <summary
        className={buttonClass({
          variant: "danger-ghost",
          size: "sm",
          flush: true,
          className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        })}
      >
        {t("divers.remove.removePersonSummary", { name: diver.person.fullName })}
      </summary>
      <form
        action={deletePersonAction.bind(null, shopSlug, personId)}
        className="mt-3 flex flex-wrap items-center gap-3"
      >
        <SubmitButton
          pendingLabel={t("divers.remove.removing")}
          className={buttonClass({ variant: "danger-solid" })}
        >
          {t("divers.remove.removeDiver")}
        </SubmitButton>
        <DiverFormStatus status={status} />
      </form>
    </details>
  );
}
