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
  type DiverProfile,
  HELD_CARD_STATUS_LABELS,
  heldCardDisplayStatus,
  heldCardStatusTone,
  isImportedCard,
  needsImportConfirm,
  type Shop,
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
            imported — is required before an EANx fill or tank handoff. An imported card clears the
            dive or fill it allows once you confirm you&apos;ve seen it.
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
              const display = heldCardDisplayStatus(card, todayLocal);
              const expired = display === "expired";
              return (
                <li key={card.id} className="px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                      <Badge tone={heldCardStatusTone(display)}>
                        {HELD_CARD_STATUS_LABELS[display]}
                      </Badge>
                      {isImportedCard(card) ? (
                        <Badge tone="neutral">
                          {card.importedFromLabel
                            ? `imported · ${card.importedFromLabel}`
                            : "imported"}
                        </Badge>
                      ) : null}
                      {card.status === "pending" && !needsImportConfirm(card) ? (
                        <form action={reviewSpecialtyAction.bind(null, shopSlug, personId)}>
                          <input type="hidden" name="certificationId" value={card.id} />
                          <SubmitButton
                            pendingLabel="Marking certified…"
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            Mark certified
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
                  </div>
                  {/* Below the row, not inside the badge group: the panel is a
                      paragraph of text, and expanding it must not shove the
                      card's own title around. */}
                  {needsImportConfirm(card) ? (
                    <ConfirmImportedCard
                      action={reviewSpecialtyAction.bind(null, shopSlug, personId)}
                      certificationId={card.id}
                      what={`the ${SPECIALTY_LABELS[card.specialty]} specialty dive this card allows`}
                    />
                  ) : null}
                </li>
              );
            })}
            {diver.nitroxCertifications.map((card) => {
              const display = heldCardDisplayStatus(card, todayLocal);
              return (
                <li key={card.id} className="px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{AGENCY_LABELS[card.agency]} · Nitrox</p>
                      <p className="mt-1 break-all text-sm text-muted">{card.identifier}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={heldCardStatusTone(display)}>
                        {HELD_CARD_STATUS_LABELS[display]}
                      </Badge>
                      {isImportedCard(card) ? (
                        <Badge tone="neutral">
                          {card.importedFromLabel
                            ? `imported · ${card.importedFromLabel}`
                            : "imported"}
                        </Badge>
                      ) : null}
                      {card.status === "pending" && !needsImportConfirm(card) ? (
                        <form action={reviewSpecialtyAction.bind(null, shopSlug, personId)}>
                          <input type="hidden" name="certificationId" value={card.id} />
                          <input type="hidden" name="cardType" value="nitrox" />
                          <SubmitButton
                            pendingLabel="Marking certified…"
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            Mark certified
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
                  </div>
                  {needsImportConfirm(card) ? (
                    <ConfirmImportedCard
                      action={reviewSpecialtyAction.bind(null, shopSlug, personId)}
                      certificationId={card.id}
                      cardType="nitrox"
                      what="the enriched-air fill this card allows"
                    />
                  ) : null}
                </li>
              );
            })}
          </>
        )}
      </ul>
    </section>
  );
}

/**
 * The confirm for an imported specialty or nitrox card. Unlike "Mark certified"
 * — which already means a staffer looked the number up with the agency — this tap
 * is the *only* thing standing between a spreadsheet cell and the dive or fill it
 * authorizes, so it states what the staffer is asserting instead of being a bare
 * button (H-24, `dive-domain-expert` review). Same shape as the paper waiver's
 * medical attestation: a disclosure, a required checkbox naming the claim, then
 * the submit. The server refuses without the checkbox too, so this is a prompt,
 * not the enforcement.
 *
 * Deliberately per-card and deliberately not offered in bulk: a "confirm all"
 * would be the same unlabelled tap this replaces, times twelve.
 */
function ConfirmImportedCard({
  action,
  certificationId,
  cardType,
  what,
}: {
  action: (formData: FormData) => void | Promise<void>;
  certificationId: string;
  cardType?: "nitrox";
  what: string;
}) {
  return (
    <details>
      <summary
        className={buttonClass({
          variant: "secondary",
          size: "sm",
          className: "cursor-pointer list-none",
        })}
      >
        Confirm card
      </summary>
      <form
        action={action}
        className="mt-2 max-w-sm rounded-lg border border-border bg-surface-sunken/50 p-3"
      >
        <input type="hidden" name="certificationId" value={certificationId} />
        {cardType ? <input type="hidden" name="cardType" value={cardType} /> : null}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="cardSighted" required className="mt-1 size-4 shrink-0" />
          <span>
            I&apos;ve seen this diver&apos;s card, or checked the number with the issuing agency.
            Confirming clears {what}.
          </span>
        </label>
        <SubmitButton
          pendingLabel="Confirming…"
          className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
        >
          Confirm card
        </SubmitButton>
      </form>
    </details>
  );
}
