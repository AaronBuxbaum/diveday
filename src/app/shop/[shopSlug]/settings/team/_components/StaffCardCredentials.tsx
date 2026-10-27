import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { controlClass, DateField, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { StatusInView } from "@/components/ui/StatusInView";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import { rolesMissingCredential } from "@/lib/crew-roles";
import { cachedListFormat } from "@/lib/intl-cache";
import type { FormNotice } from "@/lib/staff-notices";
import { type CardCredential, CREDENTIALED_ROLES } from "../credential-rows";

const MISSING_KIND_KEYS = {
  instructor: "staffing.credentials.missing.instructor",
  assistant_instructor: "staffing.credentials.missing.assistant_instructor",
  divemaster: "staffing.credentials.missing.divemaster",
  captain: "staffing.credentials.missing.captain",
} as const;

/**
 * **A staff credential is a fact, never a badge and never a gate** — ADR
 * 20260827-the-shops-shelves, decision 3 ("credentials are a quiet ledger
 * beneath; renewal words, never gates — H-59"). **The ledger is the card**
 * (visual review 2026-10-24, A09): the list that stood at the foot of the Team
 * page repeated every card above it, so each person's credentials are read,
 * reviewed and removed here, on their own card.
 *
 * What this person sails on, on the person (third review, items 2 and 36). A
 * role that sails on a card says "No credentials on file", or, when something
 * is on file that does not answer the role, names the kind it lacks ("No
 * captain’s license on file", issue #2548); anyone else with nothing recorded
 * gets no row.
 *
 * Each credential is one line: its name, its renewal word, a muted "Needs
 * review" while nobody has looked at it, and its acts. **Nothing here disables
 * anything** (H-59): a lapsed rating keeps every act a current one has, and
 * the clock is a word, never colour alone.
 */
export function StaffCardCredentials({
  personId,
  roles,
  credentials,
  locale,
  t,
  reviewAction,
  deleteAction,
  editAction,
  status,
}: {
  personId: string;
  roles: readonly Role[];
  credentials: readonly CardCredential[];
  locale: string;
  t: StaffTranslator;
  reviewAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  editAction?: (formData: FormData) => void | Promise<void>;
  status?: FormNotice;
}) {
  const sailsOnACard = roles.some((role) => CREDENTIALED_ROLES.includes(role));
  if (credentials.length === 0 && !sailsOnACard && !status) return null;
  const missing = rolesMissingCredential(
    roles,
    credentials.map((credential) => credential.kind),
  ).map((role) => t(MISSING_KIND_KEYS[role]));
  // **What needs someone stands at rest** (dive-domain review, visual review
  // 2026-10-24): an expired credential, or one nobody has reviewed, is a row
  // on the card with its state, never a line inside a closed disclosure. Only
  // the in-date, reviewed ones fold, and `#credentials` (Today's and the
  // staffing week's credential lines) lands on these cards.
  const needsSomeone = (credential: CardCredential) =>
    credential.renewal === "overdue" || !credential.reviewed;
  const atRest = credentials.filter(needsSomeone);
  const folded = credentials.filter((credential) => !needsSomeone(credential));
  const dueSoon = credentials.filter((credential) => credential.renewal === "due-soon");
  const row = (credential: CardCredential) => (
    <CredentialRow
      key={credential.id}
      credential={credential}
      t={t}
      reviewAction={reviewAction}
      deleteAction={deleteAction}
      editAction={editAction}
      personId={personId}
    />
  );
  return (
    <div className="mt-4">
      {status ? (
        <>
          <FormStatus tone={status.tone}>{status.text}</FormStatus>
          {status.tone !== "danger" ? <StatusInView /> : null}
        </>
      ) : null}
      {atRest.length > 0 ? (
        <ul
          aria-label={t("staffing.credentials.heading")}
          className="mb-2 flex flex-col gap-2 text-sm"
        >
          {atRest.map(row)}
        </ul>
      ) : null}
      <CompactDisclosureRow
        id={`credentials-${personId}`}
        label={t("staffing.credentials.heading")}
        value={
          credentials.length === 0 ? (
            t("staffing.credentials.noneOnFile")
          ) : (
            <span className="flex flex-wrap gap-x-2 gap-y-1">
              <span>{t("staffing.credentials.onFileCount", { count: credentials.length })}</span>
              {missing.map((warning) => (
                <span key={warning} className="text-base font-medium">
                  {warning}
                </span>
              ))}
              {dueSoon.length > 0 ? (
                <span className="text-base">
                  {t("staffing.credentials.dueSoonSummary", {
                    names: cachedListFormat(locale).format(
                      dueSoon.map((credential) => credential.name),
                    ),
                  })}
                </span>
              ) : null}
            </span>
          )
        }
      >
        {folded.length > 0 ? (
          <ul className="flex flex-col gap-2 text-sm">{folded.map(row)}</ul>
        ) : null}
        <Link
          href={`?credentialFor=${encodeURIComponent(personId)}#add-credential`}
          className={buttonClass({
            variant: "secondary",
            size: "sm",
            className: "mt-3 print:hidden",
          })}
        >
          {t("staffing.credentials.add")}
        </Link>
      </CompactDisclosureRow>
    </div>
  );
}

/**
 * One credential: its name, its renewal word, a muted "Needs review" while
 * nobody has looked at it, and its acts. Delete is a second, deliberate tap
 * (dive-domain review, visual review 2026-10-24): it sat a finger's width from
 * "Mark reviewed" and took the record on one.
 */
function CredentialRow({
  credential,
  t,
  reviewAction,
  deleteAction,
  editAction,
  personId,
}: {
  credential: CardCredential;
  t: StaffTranslator;
  reviewAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  editAction?: (formData: FormData) => void | Promise<void>;
  personId: string;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-medium">{credential.name}</span>
      {credential.detail ? <span className="text-muted">{credential.detail}</span> : null}
      {credential.renewalWord ? (
        <span
          className={
            credential.renewal === "overdue" || credential.renewal === "due-soon"
              ? "font-medium text-warning-strong"
              : "text-muted"
          }
        >
          {credential.renewalWord}
        </span>
      ) : null}
      {credential.reviewed ? null : (
        <Badge tone="neutral" size="sm">
          {t("staffing.credentials.pending")}
        </Badge>
      )}
      {editAction ? (
        <details className="basis-full print:hidden">
          <summary className={buttonClass({ variant: "link", size: "sm", flush: true })}>
            {t("staffing.credentials.editOrRenew")}
          </summary>
          <FieldGrid as="form" action={editAction} columns={2} className="mt-3">
            <input type="hidden" name="personId" value={personId} />
            <input type="hidden" name="revision" value={credential.revision ?? 0} />
            <input type="hidden" name="kind" value={credential.kind} />
            <Field label={t("staffing.credentials.name")}>
              <input
                name="name"
                required
                maxLength={160}
                defaultValue={credential.name}
                className={controlClass}
              />
            </Field>
            <Field label={t("staffing.credentials.issuer")}>
              <input
                name="issuingBody"
                maxLength={160}
                defaultValue={credential.issuingBody ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label={t("staffing.credentials.identifier")}>
              <input
                name="identifier"
                maxLength={120}
                defaultValue={credential.identifier ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label={t("staffing.credentials.issuedAt")}>
              <DateField name="issuedAt" defaultValue={credential.issuedAt ?? ""} />
            </Field>
            <Field label={t("staffing.credentials.renewsAt")}>
              <DateField name="renewsAt" defaultValue={credential.renewsAt ?? ""} />
            </Field>
            <div className="flex flex-wrap gap-3">
              <SubmitButton
                name="renewalOf"
                value={credential.id}
                pendingLabel={t("staffing.credentials.saving")}
                className={buttonClass()}
              >
                {t("staffing.credentials.saveRenewal")}
              </SubmitButton>
              <SubmitButton
                name="correctionOf"
                value={credential.id}
                pendingLabel={t("staffing.credentials.saving")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("staffing.credentials.saveCorrection")}
              </SubmitButton>
            </div>
          </FieldGrid>
        </details>
      ) : null}
      <span className="ms-auto flex flex-wrap items-center gap-x-6 gap-y-2 print:hidden">
        {credential.reviewed ? null : (
          <form action={reviewAction}>
            <input type="hidden" name="credentialId" value={credential.id} />
            <input type="hidden" name="revision" value={credential.revision ?? 0} />
            <input type="hidden" name="status" value="verified" />
            <SubmitButton
              pendingLabel={t("staffing.credentials.saving")}
              className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
            >
              {t("staffing.credentials.markVerified")}
            </SubmitButton>
          </form>
        )}
        <form action={deleteAction}>
          <input type="hidden" name="credentialId" value={credential.id} />
          <input type="hidden" name="revision" value={credential.revision ?? 0} />
          <InlineConfirm
            triggerLabel={t("staffing.credentials.delete")}
            confirmLabel={t("staffing.credentials.deleteConfirm", { name: credential.name })}
            pendingLabel={t("staffing.credentials.deleting")}
            triggerClassName={buttonClass({ variant: "danger-ghost", size: "sm", flush: true })}
            autoResetMs={6000}
          />
        </form>
      </span>
    </li>
  );
}
