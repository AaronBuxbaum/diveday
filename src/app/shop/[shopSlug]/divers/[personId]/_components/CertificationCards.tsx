import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { nowDate } from "@/lib/clock";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import { addCertificationAction, deleteCertificationAction, reviewAction } from "../actions";
import {
  AGENCY_LABELS,
  CARD_STATUS_LABELS,
  cardDisplayStatus,
  type DiverProfile,
  statusTone,
} from "./shared";

export function CertificationCards({
  diver,
  shopSlug,
  personId,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
}) {
  const now = nowDate();
  return (
    <section className="mt-10" aria-labelledby="cards-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="cards-heading" className="text-lg font-semibold">
            Certification cards
          </h2>
          <p className="mt-1 text-sm text-muted">
            Evidence starts pending. Look the card number up with the issuing agency, then mark it
            certified — only certified cards affect readiness.
          </p>
        </div>
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
            Add card
          </summary>
          <FieldGrid
            as="form"
            action={addCertificationAction.bind(null, shopSlug, personId)}
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
            <Field label="Level">
              <select name="level" className={controlClass}>
                {Object.entries(CERTIFICATION_LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
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
                Capture for review
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </details>
      </div>
      <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
        {diver.certifications.length === 0 ? (
          <li className="px-4 py-5 text-sm text-muted">
            No level cards yet — add their first card above so it can make them trip-ready.
          </li>
        ) : (
          diver.certifications.map((card) => {
            const display = cardDisplayStatus(card, now);
            const expired = display === "expired";
            return (
              <li
                key={card.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {AGENCY_LABELS[card.agency]} · {CERTIFICATION_LEVEL_LABELS[card.level]}
                  </p>
                  <p className="mt-1 break-all text-sm text-muted">
                    {card.identifier}
                    {card.expiresAt ? (
                      <span className={expired ? "font-medium text-danger" : undefined}>
                        {` · ${expired ? "expired" : "expires"} ${card.expiresAt.toLocaleDateString("en-US")}`}
                      </span>
                    ) : null}
                  </p>
                  {card.reviewNote ? (
                    <p className="mt-1 text-sm text-muted italic">{card.reviewNote}</p>
                  ) : null}
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
                    className={`rounded-full px-3 py-1 text-sm font-medium ${statusTone(display)}`}
                  >
                    {CARD_STATUS_LABELS[display]}
                  </span>
                  {card.status === "pending" ? (
                    <form action={reviewAction.bind(null, shopSlug, personId)}>
                      <input type="hidden" name="certificationId" value={card.id} />
                      <SubmitButton
                        pendingLabel="Marking certified…"
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        Mark certified
                      </SubmitButton>
                    </form>
                  ) : null}
                  <form action={deleteCertificationAction.bind(null, shopSlug, personId)}>
                    <input type="hidden" name="certificationId" value={card.id} />
                    <SubmitButton
                      pendingLabel="Deleting…"
                      confirmMessage="Delete this certification card? It stops counting toward readiness; its history is kept for records."
                      className={buttonClass({ variant: "danger", size: "sm" })}
                    >
                      Delete
                    </SubmitButton>
                  </form>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
