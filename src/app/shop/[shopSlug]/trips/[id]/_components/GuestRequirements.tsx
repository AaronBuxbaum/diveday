import type { ReactNode } from "react";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { BLOCKER_CATEGORY } from "@/lib/readiness";
import type { RowReasonLines } from "./roster-row-reasons";
import type { RosterSeat } from "./roster-seat";

/**
 * What fixes an opened guest, first (drawing `24-clock-guest-opened`).
 * Requirement families share a remedy; every underlying blocker stays visible.
 * The row above already says whether they can board, so no heading repeats it,
 * and a missing contact points at its form, the "If needed" fact below.
 */
export function GuestRequirements({
  lines,
  blockers,
  payment,
  contact,
  t,
}: {
  lines: RowReasonLines["reasonLines"];
  blockers: RosterSeat["blockerTexts"];
  payment: ReactNode;
  /** The door to the contact form among the facts below. */
  contact: ReactNode;
  t: StaffTranslator;
}) {
  const titles = {
    waiver: t("trips.folio.requirementWaiver"),
    certification: t("trips.folio.requirementCertification"),
    payment: t("trips.folio.requirementPayment"),
    medical: t("trips.folio.requirementMedical"),
    identity: t("trips.folio.requirementIdentity"),
    setup: t("trips.folio.requirementOther"),
    contact: t("trips.roster.emergencyContactHeading"),
  };
  type Family = keyof typeof titles;
  const required = new Map<Family, { text: string[]; actions: ReactNode[]; blocking: boolean }>();
  const preparation: typeof lines = [];
  for (const line of lines) {
    const blocker = blockers.find(
      (item) => item.text === line.key || item.text === line.text,
    )?.blocker;
    const family: Family | null = blocker
      ? blocker.code.startsWith("medical_")
        ? "medical"
        : blocker.code.startsWith("identity_")
          ? "identity"
          : BLOCKER_CATEGORY[blocker.code]
      : line.key === "waiver-remedy" || line.key === "waiver"
        ? "waiver"
        : line.key === "payment"
          ? "payment"
          : line.key === "contact"
            ? "contact"
            : line.tone === "danger"
              ? "setup"
              : null;
    if (!family) {
      preparation.push(line);
      continue;
    }
    const row = required.get(family) ?? { text: [], actions: [], blocking: false };
    // A readiness payment blocker already states the debt; the desk's amber
    // "Not paid yet" line is the same fact, not another task.
    if (!(family === "payment" && line.key === "payment" && row.text.length))
      row.text.push(line.text);
    if (line.actions) row.actions.push(line.actions);
    row.blocking ||= line.tone === "danger";
    required.set(family, row);
  }
  return (
    <div className="space-y-3">
      {([true, false] as const).map((blocking) => {
        const rows = [...required].filter(([, row]) => row.blocking === blocking);
        if (!rows.length && (blocking || !preparation.length)) return null;
        return (
          <section
            key={String(blocking)}
            aria-label={t(
              blocking ? "trips.folio.beforeBoarding" : "trips.roster.informationAndPreparation",
            )}
          >
            <div className="divide-y divide-border">
              {rows.map(([family, row]) => (
                <section key={family} aria-label={titles[family]} className="py-3 first:pt-0">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-5 gap-y-3">
                    <div className="min-w-0">
                      {/* The sentence is the title: the family's name ("Certification")
                          only repeated it, under a status line that had said it already. */}
                      <div className="space-y-1 text-sm text-muted">
                        {row.text.map((text, index) => (
                          <p
                            key={text}
                            className={index === 0 ? "font-semibold text-foreground" : ""}
                          >
                            {text}
                          </p>
                        ))}
                      </div>
                    </div>
                    {/* Only expanded editors span the task; closed disclosures and
                        button-only server-action forms keep the compact action column
                        from `sm`. On a phone the column was 144px, and "Waiver sent ·
                        Resend" wrapped inside its pill: there the doors go under the
                        words. */}
                    {family !== "payment" && family !== "contact" && row.actions.length ? (
                      <div className="min-w-0 max-sm:col-span-full has-[[data-task-remedy-form],details[open]_form]:col-span-full has-[[data-task-remedy-form],details[open]_form]:max-w-none sm:max-w-44 [&>div]:mt-0 [&_[data-task-remedy-form]]:max-w-none [&_button]:max-w-full [&_a]:max-w-full">
                        {row.actions}
                      </div>
                    ) : null}
                  </div>
                  {family === "payment" ? <div className="mt-3">{payment}</div> : null}
                  {family === "contact" ? <div className="mt-2">{contact}</div> : null}
                </section>
              ))}
            </div>
            {!blocking && preparation.length ? (
              <div className="mt-2 space-y-3 text-sm">
                {preparation.map((line) => (
                  <div key={line.key}>
                    <p>{line.text}</p>
                    {line.actions}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
