import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { SPECIALTY_LABELS } from "@/lib/readiness";
import { addSpecialtyAction, reviewSpecialtyAction } from "../actions";
import { AGENCY_LABELS, CARD_STATUS_LABELS, type DiverProfile, statusTone } from "./shared";

export function SpecialtyCards({
  diver,
  shopSlug,
  personId,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
}) {
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="specialty-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="specialty-heading" className="text-lg font-semibold">
            Specialty cards
          </h2>
          <p className="mt-1 text-sm text-muted">
            Specialty cards live with the diver. A verified Nitrox card is required before an EANx
            fill or tank handoff.
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
            <Field label="Expiry" hint="(if issued)">
              <input name="expiresOn" type="date" className={controlClass} />
            </Field>
            <Field
              label="Card photo"
              hint="(optional; JPG, PNG, or WebP; ≤5 MB)"
              className="sm:col-span-2"
            >
              <input
                name="cardImage"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                className={controlClass}
              />
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
            {diver.specialtyCertifications.map((card) => (
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
                    {card.expiresAt
                      ? ` · expires ${card.expiresAt.toLocaleDateString("en-US")}`
                      : ""}
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
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-medium ${statusTone(card.status)}`}
                  >
                    {CARD_STATUS_LABELS[card.status]}
                  </span>
                  {card.status === "pending" ? (
                    <>
                      <form action={reviewSpecialtyAction.bind(null, shopSlug, personId)}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <input type="hidden" name="status" value="verified" />
                        <SubmitButton
                          pendingLabel="Marking certified…"
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          Mark certified
                        </SubmitButton>
                      </form>
                      <form action={reviewSpecialtyAction.bind(null, shopSlug, personId)}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <input type="hidden" name="status" value="rejected" />
                        <SubmitButton
                          pendingLabel="Updating…"
                          className={buttonClass({ variant: "danger", size: "sm" })}
                        >
                          Needs correction
                        </SubmitButton>
                      </form>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
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
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-medium ${statusTone(card.status)}`}
                  >
                    {CARD_STATUS_LABELS[card.status]}
                  </span>
                  {card.status === "pending" ? (
                    <>
                      <form action={reviewSpecialtyAction.bind(null, shopSlug, personId)}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <input type="hidden" name="cardType" value="nitrox" />
                        <input type="hidden" name="status" value="verified" />
                        <SubmitButton
                          pendingLabel="Marking certified…"
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          Mark certified
                        </SubmitButton>
                      </form>
                      <form action={reviewSpecialtyAction.bind(null, shopSlug, personId)}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <input type="hidden" name="cardType" value="nitrox" />
                        <input type="hidden" name="status" value="rejected" />
                        <SubmitButton
                          pendingLabel="Updating…"
                          className={buttonClass({ variant: "danger", size: "sm" })}
                        >
                          Needs correction
                        </SubmitButton>
                      </form>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </>
        )}
      </ul>
    </section>
  );
}
