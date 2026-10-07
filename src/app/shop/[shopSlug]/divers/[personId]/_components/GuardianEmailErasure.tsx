import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DangerDisclosure } from "@/components/ui/disclosure";
import { controlClass, Field } from "@/components/ui/form";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { staffTranslator } from "@/i18n/staff-messages";
import { eraseGuardianEmailAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";

/**
 * **A co-signing guardian's address, erased on its own** (H-103, issue #1673).
 *
 * A parent who co-signed a minor's release is a third party: they have no
 * record of their own, so the only place their address can be taken back is
 * the child's record. Owner-only like the diver's erasure (the page checks,
 * the action re-checks, and `eraseGuardianEmail` checks again), behind a
 * disclosure and a typed confirmation of the address. Unlike the diver's
 * erasure it is offered on a live record, because the child stays a diver.
 */
export function GuardianEmailErasure({
  emails,
  shopSlug,
  personId,
  locale,
  status,
}: {
  /** The distinct guardian addresses on this diver's releases (`listGuardianEmails`). */
  emails: string[];
  shopSlug: string;
  personId: string;
  locale: string;
  status?: DiverNotice;
}) {
  const t = staffTranslator(locale);
  if (emails.length === 0) return null;
  return (
    <section aria-labelledby="guardian-email-heading">
      <h2 id="guardian-email-heading" className={`scroll-mt-24 ${SECTION_TITLE_CLASS}`}>
        {t("divers.guardianEmail.heading")}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t("divers.guardianEmail.description")}</p>
      <DiverFormStatus status={status} />
      {emails.map((email, index) => {
        const inputId = `guardian-email-confirm-${index}`;
        return (
          <DangerDisclosure
            key={email}
            open={Boolean(status) && emails.length === 1}
            className="mt-4"
            summary={t("divers.guardianEmail.summary", { email })}
          >
            <form
              action={eraseGuardianEmailAction.bind(null, shopSlug, personId)}
              className="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="email" value={email} />
              <Field
                label={t("divers.guardianEmail.confirmLabel", { email })}
                hint={t("divers.guardianEmail.confirmHint")}
                htmlFor={inputId}
              >
                <input
                  id={inputId}
                  name="confirmEmail"
                  type="email"
                  required
                  autoComplete="off"
                  className={controlClass}
                  placeholder={email}
                />
              </Field>
              <SubmitButton
                pendingLabel={t("divers.guardianEmail.erasing")}
                className={buttonClass({ variant: "danger-solid" })}
              >
                {t("divers.guardianEmail.erase")}
              </SubmitButton>
            </form>
          </DangerDisclosure>
        );
      })}
    </section>
  );
}
