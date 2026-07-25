import { ImageFileInput } from "@/components/ImageFileInput";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { SPECIALTY_LABELS } from "@/lib/readiness";
import { addSpecialtyAction, deleteSpecialtyAction, reviewSpecialtyAction } from "../actions";
import {
  AGENCY_LABELS,
  CARD_STATUS_LABELS,
  type DiverProfile,
  isImportedCard,
  needsImportConfirm,
  type Shop,
  SPECIALTY_STATUS_LABELS,
  specialtyDisplayStatus,
  specialtyStatusTone,
  statusTone,
} from "./shared";

export function SpecialtyCards({
  diver,
  shopSlug,
  personId,
  shop,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  shop: Shop;
}) {
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="specialty-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="specialty-heading" className="text-lg font-semibold">
            Specialty cards
          </h2>
          <p className="mt-1 text-sm text-muted">
            Specialty cards live with the diver. A verified Nitrox card — confirmed here if it was
            imported — is required before an EANx fill or tank handoff. An imported specialty card
            clears its dive once you confirm it here.
          </p>
        </div>
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
            Add specialty
          </summary>
          <FieldGrid
            as="form"
            action={addSpecialtyAction.bind(null, shopSlug, personId)}
            encType="multipart/form-data"
            columns={2}
            className="mt-3 gap-y-3 rounded-lg border border-border bg-surface p-4 sm:w-[32rem]"
          >
            <Field label="Agency">
              <select name="agency" className={controlClass}>
                {Object.entries(AGENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Specialty">
              <select name="specialty" className={controlClass}>
                {[...Object.entries(SPECIALTY_LABELS), ["nitrox", "Nitrox"]].map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </Field>
            <Field label="Card number">
              <input name="identifier" required className={controlClass} />
            </Field>
            <Field label="Refresher due" hint="(optional; shop policy — cards don’t expire)">
              <input name="expiresOn" type="date" className={controlClass} />
            </Field>
            <Field
              label="Card photo"
              hint="(optional; JPG, PNG, or WebP; ≤5 MB)"
              className="sm:col-span-2"
            >
              <ImageFileInput name="cardImage" />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel="Capturing…"
                className={buttonClass({ variant: "secondary" })}
              >
                Capture specialty for review
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </details>
      </div>
      <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
        {diver.specialtyCertifications.length === 0 && diver.nitroxCertifications.length === 0 ? (
          <li className="px-4 py-5 text-sm text-muted">
            No specialty or nitrox cards yet — add one above when they earn it.
          </li>
        ) : (
          <>
            {diver.specialtyCertifications.map((card) => {
              const display = specialtyDisplayStatus(card, todayLocal);
              const expired = display === "expired";
              return (
                <li
                  key={card.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">
                      {AGENCY_LABELS[card.agency]} · {SPECIALTY_LABELS[card.specialty]}
                    </p>
                    <p className="mt-1 break-all text-sm text-muted">
                      {card.identifier}
                      {card.expiresAt ? (
                        <span className={expired ? "font-medium text-danger" : undefined}>
                          {` · refresher ${expired ? "overdue" : "due"} ${formatCalendarDate(card.expiresAt)}`}
                        </span>
                      ) : null}
                    </p>
                    {card.cardImageUrl ? (
                      <a
                        href={card.cardImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-sm font-medium text-primary hover:underline"
                      >
                        View card photo
                      </a>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={specialtyStatusTone(display)}>
                      {SPECIALTY_STATUS_LABELS[display]}
                    </Badge>
                    {isImportedCard(card) ? (
                      <Badge tone="neutral">
                        {card.importedFromLabel
                          ? `imported · ${card.importedFromLabel}`
                          : "imported"}
                      </Badge>
                    ) : null}
                    {/* An imported specialty card holds its gate until this confirm
                        (ADR 20260725-import-specialty-cards), so the label says what
                        the tap is for rather than repeating "mark certified". */}
                    {card.status === "pending" || needsImportConfirm(card) ? (
                      <form action={reviewSpecialtyAction.bind(null, shopSlug, personId)}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <SubmitButton
                          pendingLabel={
                            needsImportConfirm(card) ? "Confirming…" : "Marking certified…"
                          }
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          {needsImportConfirm(card) ? "Confirm card" : "Mark certified"}
                        </SubmitButton>
                      </form>
                    ) : null}
                    <form action={deleteSpecialtyAction.bind(null, shopSlug, personId)}>
                      <input type="hidden" name="certificationId" value={card.id} />
                      {/* No confirm dialog: the delete lands and a toast offers a one-tap undo. */}
                      <SubmitButton
                        pendingLabel="Deleting…"
                        className={buttonClass({ variant: "danger", size: "sm" })}
                      >
                        Delete
                      </SubmitButton>
                    </form>
                  </div>
                </li>
              );
            })}
            {diver.nitroxCertifications.map((card) => (
              <li
                key={card.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{AGENCY_LABELS[card.agency]} · Nitrox</p>
                  <p className="mt-1 break-all text-sm text-muted">{card.identifier}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(card.status)}>{CARD_STATUS_LABELS[card.status]}</Badge>
                  {isImportedCard(card) ? (
                    <Badge tone="neutral">
                      {card.importedFromLabel ? `imported · ${card.importedFromLabel}` : "imported"}
                    </Badge>
                  ) : null}
                  {card.status === "pending" || needsImportConfirm(card) ? (
                    <form action={reviewSpecialtyAction.bind(null, shopSlug, personId)}>
                      <input type="hidden" name="certificationId" value={card.id} />
                      <input type="hidden" name="cardType" value="nitrox" />
                      <SubmitButton
                        pendingLabel={
                          needsImportConfirm(card) ? "Confirming…" : "Marking certified…"
                        }
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        {needsImportConfirm(card) ? "Confirm card" : "Mark certified"}
                      </SubmitButton>
                    </form>
                  ) : null}
                  <form action={deleteSpecialtyAction.bind(null, shopSlug, personId)}>
                    <input type="hidden" name="certificationId" value={card.id} />
                    <input type="hidden" name="cardType" value="nitrox" />
                    {/* No confirm dialog: the delete lands and a toast offers a one-tap undo. */}
                    <SubmitButton
                      pendingLabel="Deleting…"
                      className={buttonClass({ variant: "danger", size: "sm" })}
                    >
                      Delete
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </>
        )}
      </ul>
    </section>
  );
}
