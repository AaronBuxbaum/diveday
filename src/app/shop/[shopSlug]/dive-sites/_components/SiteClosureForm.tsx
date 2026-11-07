import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, DateField, Field, FormStatus } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { SERVICE_WINDOW_REASON_MAX } from "@/lib/service-window";

/**
 * **A site closed for a while** (loop 5, row 5): two days and a reason. While
 * the window covers the shop's today, divers no longer find the site's public
 * page, and the board warns about a departure planned there. Clearing both
 * days opens it again. Nothing moves on the departures themselves.
 */
export function SiteClosureForm({
  action,
  site,
  t,
  state,
  closedLine,
}: {
  action: (formData: FormData) => void;
  site: { closedFrom: string | null; closedUntil: string | null; closureReason: string | null };
  t: StaffTranslator;
  /** This form's outcome from the redirect's `?notice=`, when it was this form. */
  state: "saved" | "invalid" | null;
  /** "Closed Nov 10 – Nov 20: Mooring buoys out", already worded; null while open. */
  closedLine: string | null;
}) {
  return (
    <section aria-labelledby="site-closure-heading" className="mt-10">
      <h2 id="site-closure-heading" className="font-semibold">
        {t("diveSites.closure.heading")}
      </h2>
      <p className="mt-1 max-w-2xl text-muted">{closedLine ?? t("diveSites.closure.body")}</p>
      <form action={action} className="mt-4 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("diveSites.closure.fromLabel")}>
          <DateField name="closedFrom" defaultValue={site.closedFrom ?? ""} />
        </Field>
        <Field label={t("diveSites.closure.untilLabel")}>
          <DateField name="closedUntil" defaultValue={site.closedUntil ?? ""} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("diveSites.closure.reasonLabel")}>
            <input
              name="closureReason"
              type="text"
              maxLength={SERVICE_WINDOW_REASON_MAX}
              defaultValue={site.closureReason ?? ""}
              className={controlClass}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <SubmitButton
            pendingLabel={t("words.busy.saving")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("diveSites.closure.save")}
          </SubmitButton>
          <FormStatus tone={state === "invalid" ? "danger" : "success"} className="mt-2">
            {state === "invalid"
              ? t("diveSites.closure.invalid")
              : state === "saved"
                ? t("diveSites.closure.saved")
                : undefined}
          </FormStatus>
        </div>
      </form>
    </section>
  );
}
