import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SubmitButton } from "@/components/SubmitButton";
import { ThreadShell } from "@/components/thread/ThreadShell";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { ChoiceRow, controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { StatusInView } from "@/components/ui/StatusInView";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { staleBookingCapabilityForToken } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { getCourseFormsForBooking, verifyCourseFormsLink } from "@/db/course-forms";
import { getShopById } from "@/db/shops";
import { diverGuardianRelationshipOptions } from "@/i18n/guardian-labels";
import { type DiverMessageKey, diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { nowDate } from "@/lib/clock";
import { guardianSignatureRequired, signingDate } from "@/lib/guardian";
import { signCourseFormFromReady } from "../paperwork-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return { title: t("courseForms.metaTitle"), robots: { index: false, follow: false } };
}

// A real static shell: every request-scoped read below sits inside this
// segment's `loading.tsx` boundary (ADR 20260804-instant-navigation).
export const instant = true;

/** `?error=` words the action sends back, each to its sentence. */
const ERRORS: Record<string, DiverMessageKey> = {
  agreement: "courseForms.errorAgreement",
  name: "waiver.errorNameMismatch",
  guardian: "courseForms.errorGuardian",
  version: "courseForms.versionChanged",
  unavailable: "courseForms.errorUnavailable",
  rate: "waiver.rateLimited",
};

/**
 * **The course's forms, signed one at a time on the diver's own link** (ADR
 * 20261008-course-forms).
 *
 * Two links open it, each proving the bearer holds this one enrollment: the
 * diver's readiness link, and the forms-only link staff hand over when the
 * release is signed and the forms are not (`course_forms`, which opens this
 * page and no other). A readiness link the page cannot vouch for — dead,
 * revoked, a cancelled seat — goes back to `/ready`, which already says each of
 * those honestly; a dead forms-only link says so here, since `/ready` is not
 * its page. A seat held for staff to confirm who it is draws no form.
 *
 * One form per screen, in the course's order, its full words above the
 * signature — the release's own shape (`/waivers/[token]`): a typed name that
 * must be the student's, an agreement box, and for a minor a guardian's card
 * carrying the Sign button, so nobody signs above words they have not reached.
 */
export default async function CourseFormsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; signed?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { error, signed } = await searchParams;
  const prep = `/ready/${token}`;
  const db = await getDb();
  const capability = await verifyCourseFormsLink(db, token);
  if (!capability) {
    const dead = await staleBookingCapabilityForToken(db, { token, purpose: "course_forms" });
    const deadShop = dead ? await getShopById(db, dead.shopId) : null;
    if (!deadShop) redirect(prep);
    const t = diverTranslator(await requestLocale(deadShop.defaultLocale));
    return (
      <ThreadShell shopName={deadShop.name} title={t("courseForms.linkDeadTitle")}>
        <p className="mt-4 text-base text-muted">
          {t("courseForms.linkDeadBody", { shopName: deadShop.name })}
        </p>
      </ThreadShell>
    );
  }
  const [shop, forms] = await Promise.all([
    getShopById(db, capability.shopId),
    getCourseFormsForBooking(db, capability.shopId, capability.bookingId),
  ]);
  if (!shop || !forms || forms.enrollment.identityHeld) redirect(prep);
  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);
  const { enrollment, required, outstanding } = forms;
  // A forms-only link cannot open the prep page, so it is never offered one.
  const offerPrep = !capability.formsOnly;

  if (outstanding.length === 0) {
    return (
      <ThreadShell shopName={shop.name} title={t("courseForms.doneTitle")}>
        <p className="mt-4 text-base text-muted">{t("courseForms.doneBody")}</p>
        {offerPrep ? (
          <Link href={prep} className={`${buttonClass()} mt-6`}>
            {t("courseForms.backToPrep")}
          </Link>
        ) : null}
      </ThreadShell>
    );
  }

  const [form] = outstanding;
  if (!form) redirect(prep);
  const current = required.length - outstanding.length + 1;
  // A minor today, or a form the student already signed alone as a minor:
  // either way the guardian's half is what this page collects.
  const guardianRequired =
    form.gap === "guardian_missing" ||
    guardianSignatureRequired(enrollment.dateOfBirth, signingDate(nowDate(), enrollment.timezone));
  const errorKey = error && Object.hasOwn(ERRORS, error) ? ERRORS[error] : undefined;

  const signBlock = (
    <>
      <SubmitButton pendingLabel={t("courseForms.signing")} className={`${buttonClass()} mt-6`}>
        {t("courseForms.signButton")}
      </SubmitButton>
      <p className="mt-3 text-sm text-muted">{t("courseForms.signatureNote")}</p>
    </>
  );

  return (
    <ThreadShell
      shopName={shop.name}
      title={form.title}
      meta={
        <p className="mt-2 text-base text-muted">
          {t("courseForms.progress", { current, total: required.length })}
          {" · "}
          {enrollment.tripTitle}
        </p>
      }
    >
      {errorKey ? (
        <div className="mt-6">
          <FormStatus tone="danger">{t(errorKey)}</FormStatus>
          <StatusInView />
        </div>
      ) : signed === "1" ? (
        <div className="mt-6">
          <FormStatus tone="success">{t("courseForms.signedOne")}</FormStatus>
        </div>
      ) : null}
      {/* The shop's own words, exactly as stored for this version. Neither
          translated nor reflowed: they are what the student signs. */}
      <div
        data-course-form-body
        className="mt-6 wrap-anywhere whitespace-pre-wrap border-b border-border pb-8 text-base leading-7"
      >
        {form.body}
      </div>
      <form action={signCourseFormFromReady.bind(null, token)} className="mt-8 flex flex-col gap-6">
        <input type="hidden" name="formVersionId" value={form.versionId} />
        <SectionCard padding="lg">
          <h2 className={SECTION_TITLE_CLASS}>{t("waiver.signature")}</h2>
          <FieldGrid columns={1} className="mt-4">
            <Field
              label={t("waiver.typeFullName")}
              description={t("waiver.typeFullNameHint", { name: enrollment.fullName })}
            >
              <input
                id="signerName"
                name="signerName"
                autoComplete="name"
                required
                minLength={2}
                maxLength={120}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <ChoiceRow
            type="checkbox"
            id="acknowledged"
            name="acknowledged"
            value="on"
            required
            outdent="block-end"
            className="mt-4 text-base"
          >
            {t("courseForms.agreementCheckbox")}
          </ChoiceRow>
          {guardianRequired ? null : signBlock}
        </SectionCard>
        {guardianRequired ? (
          <SectionCard padding="lg">
            <h2 className={SECTION_TITLE_CLASS}>{t("waiver.guardianHeading")}</h2>
            <p className="mt-2 text-sm text-muted">
              {t("courseForms.guardianIntro", { name: enrollment.fullName })}
            </p>
            <FieldGrid columns={1} className="mt-4">
              <Field label={t("waiver.guardianName")}>
                <input
                  id="guardianName"
                  name="guardianName"
                  autoComplete="off"
                  required
                  minLength={2}
                  maxLength={120}
                  className={controlClass}
                />
              </Field>
              <Field label={t("waiver.guardianRelationship", { name: enrollment.fullName })}>
                <select
                  id="guardianRelationship"
                  name="guardianRelationship"
                  required
                  defaultValue=""
                  className={controlClass}
                >
                  <option value="" disabled>
                    {t("waiver.guardianRelationshipChoose")}
                  </option>
                  {diverGuardianRelationshipOptions(t).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </FieldGrid>
            <ChoiceRow
              type="checkbox"
              id="guardianAcknowledged"
              name="guardianAcknowledged"
              value="on"
              required
              className="mt-4 text-base"
            >
              {t("courseForms.guardianAgreementCheckbox")}
            </ChoiceRow>
            {signBlock}
          </SectionCard>
        ) : null}
      </form>
      {offerPrep ? (
        <p className="mt-8 text-center text-sm">
          <Link href={prep} className="font-medium text-primary hover:underline">
            {t("courseForms.backToPrep")}
          </Link>
        </p>
      ) : null}
    </ThreadShell>
  );
}
