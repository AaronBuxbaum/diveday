import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { EarnedMoment } from "@/components/EarnedMoment";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { bookings, diveSites, type MedicalAnswers, tripDives, trips } from "@/db/schema";
import { getShopById } from "@/db/shops";
import {
  completeWaiver,
  getEmergencyContactForBooking,
  getWaiverForToken,
  requireTokenBookingId,
  saveBookingEmergencyContact,
  saveWaiverDraft,
} from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { trackEvent } from "@/lib/analytics";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { emergencyContactSchema } from "@/lib/contact";
import type { MedicalQuestionnaire } from "@/lib/medical";
import { questionnaireForJurisdiction } from "@/lib/medical";
import { revalidateAndRedirect } from "@/lib/navigation";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

export const metadata: Metadata = {
  title: "Complete your waiver — DiveDay",
  robots: { index: false, follow: false },
};

const signatureSchema = z.object({
  signerName: z.string().trim().max(120),
  acknowledged: z.string().optional(),
});

const completeSignatureSchema = z.object({
  signerName: z.string().trim().min(2).max(120),
  acknowledged: z.literal("on"),
});

/** Reads every question's yes/no answer for the presented questionnaire. */
function readMedicalAnswers(
  formData: FormData,
  questionnaire: MedicalQuestionnaire,
): MedicalAnswers | null {
  const responses: Record<string, boolean> = {};
  for (const question of questionnaire.questions) {
    const value = formData.get(`q_${question.id}`);
    if (value !== "yes" && value !== "no") return null;
    responses[question.id] = value === "yes";
  }
  return {
    questionnaireId: questionnaire.id,
    questionnaireVersion: questionnaire.version,
    responses,
  };
}

/**
 * `buttonClass` bakes in `text-sm`, and a plain `text-base` in `className` loses
 * the cascade because Tailwind emits `.text-sm` after `.text-base`. This waiver
 * is read at arm's length on a dock, so its actions keep their 16px label via
 * the token-valued utility, which does win.
 */
const labelTextBase = "text-(length:--text-base) leading-6";

function RadioQuestion({
  name,
  question,
  yes,
}: {
  name: string;
  question: string;
  yes: boolean | undefined;
}) {
  return (
    <fieldset className="rounded-lg border border-border bg-surface p-4">
      <legend className="px-1 text-base font-medium">{question}</legend>
      <div className="mt-3 flex gap-3">
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-base hover:bg-surface-sunken">
          <input type="radio" name={name} value="no" defaultChecked={yes !== true} required />
          No
        </label>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-base hover:bg-surface-sunken">
          <input type="radio" name={name} value="yes" defaultChecked={yes === true} required />
          Yes
        </label>
      </div>
    </fieldset>
  );
}

export default async function WaiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { saved, error } = await searchParams;
  const db = await getDb();
  // A dead or expired link resolves no shop, so there is no
  // `shops.default_locale` to fall back to — negotiate from the visitor's own
  // device alone for those branches.
  const anonT = diverTranslator(await requestLocale());
  const state = await getWaiverForToken(db, token);

  if (state.state === "unavailable") {
    return (
      <Unavailable
        title={anonT("waiver.unavailableHeading")}
        text={anonT("waiver.unavailableBody")}
      />
    );
  }

  if (state.state === "expired") {
    return (
      <Unavailable title={anonT("waiver.expiredHeading")} text={anonT("waiver.expiredBody")} />
    );
  }

  const shop = await getShopById(db, state.record.shopId);
  if (!shop) {
    return (
      <Unavailable
        title={anonT("waiver.unavailableHeading")}
        text={anonT("waiver.unavailableBody")}
      />
    );
  }
  const shopName = shop.name;
  const t = diverTranslator(await requestLocale(shop.defaultLocale));
  if (state.state === "completed") {
    const needsReview = state.record.status === "medical_review";
    const bookingId = requireTokenBookingId(state.record);
    const booking = await db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1)
      .then((rows) => rows[0]);

    const diveSitesList: {
      name: string;
      description: string | null;
      difficulty: string | null;
      depthRange: string | null;
      imageUrls: string[];
    }[] = [];

    if (booking?.tripId) {
      const tripSites = await db
        .select({
          name: diveSites.name,
          description: diveSites.description,
          difficulty: diveSites.difficulty,
          depthRange: diveSites.depthRange,
          imageUrls: diveSites.imageUrls,
        })
        .from(trips)
        .innerJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
        .where(eq(trips.id, booking.tripId))
        .limit(1);

      const tripDiveSites = await db
        .select({
          name: diveSites.name,
          description: diveSites.description,
          difficulty: diveSites.difficulty,
          depthRange: diveSites.depthRange,
          imageUrls: diveSites.imageUrls,
        })
        .from(tripDives)
        .innerJoin(diveSites, eq(diveSites.id, tripDives.diveSiteId))
        .where(eq(tripDives.tripId, booking.tripId));

      const seenNames = new Set<string>();
      for (const site of [...tripSites, ...tripDiveSites]) {
        if (!seenNames.has(site.name)) {
          seenNames.add(site.name);
          diveSitesList.push(site);
        }
      }
    }

    const readyCapability = await issueBookingCapability(db, {
      shopId: state.record.shopId,
      bookingId,
      purpose: "readiness",
    });
    const readyPath = readyCapability ? readinessLinkPath(readyCapability.token) : null;
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
        <EarnedMoment
          as="h1"
          eyebrow={shopName}
          title={needsReview ? t("capability.waiverReceived") : t("capability.waiverDone")}
        >
          <p>{needsReview ? t("waiver.medicalReview") : t("waiver.signedBody")}</p>
          {readyPath ? (
            <Link href={readyPath} className={buttonClass({ className: "mt-5" })}>
              {t("waiver.seeWhatsLeft")}
            </Link>
          ) : null}
        </EarnedMoment>

        {diveSitesList.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold tracking-tight">{t("waiver.scheduledSites")}</h2>
            <p className="text-sm text-muted mt-1">{t("waiver.sitesPeek")}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {diveSitesList.map((site) => (
                <div
                  key={site.name}
                  className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
                >
                  {site.imageUrls && site.imageUrls.length > 0 ? (
                    // biome-ignore lint/performance/noImgElement: standard img tag is preferred for dynamic external site images
                    <img
                      src={site.imageUrls[0]}
                      alt={site.name}
                      className="h-32 w-full object-cover"
                    />
                  ) : (
                    <div className="h-32 w-full bg-surface-sunken flex items-center justify-center text-3xl">
                      🐠
                    </div>
                  )}
                  <div className="p-4">
                    <h3 className="font-bold text-base">{site.name}</h3>
                    {(site.depthRange || site.difficulty) && (
                      <p className="text-xs font-semibold text-primary mt-0.5">
                        {site.depthRange ? `${site.depthRange}` : ""}
                        {site.depthRange && site.difficulty ? " · " : ""}
                        {site.difficulty ? `${site.difficulty}` : ""}
                      </p>
                    )}
                    {site.description && (
                      <p className="mt-2 text-sm text-muted line-clamp-3">{site.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    );
  }

  const { record } = state;
  const recordBookingId = requireTokenBookingId(record);
  const emergencyContact = await getEmergencyContactForBooking(db, recordBookingId);
  const questionnaire = questionnaireForJurisdiction(shop.jurisdiction);
  const draft = record.draftMedicalAnswers;
  /** Only pre-fill draft answers captured against this same questionnaire. */
  const draftResponses =
    draft && draft.questionnaireId === questionnaire.id ? draft.responses : undefined;
  const errorText =
    error === "invalid"
      ? t("waiver.incomplete")
      : error === "unavailable"
        ? t("waiver.linkInactive")
        : undefined;

  async function saveDraftAction(formData: FormData) {
    "use server";
    const ip = await clientIp();
    if (!checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction).allowed) {
      redirect(`/waivers/${token}?error=invalid`);
    }
    const parsed = signatureSchema.safeParse(Object.fromEntries(formData));
    const answers = readMedicalAnswers(formData, questionnaire);
    if (!parsed.success || !answers) redirect(`/waivers/${token}?error=invalid`);
    const db = await getDb();
    const savedDraft = await saveWaiverDraft(db, token, {
      signerName: parsed.data.signerName,
      acknowledged: parsed.data.acknowledged === "on",
      medicalAnswers: answers,
    });
    // Persist the contact now too, so "save and finish later" keeps it — blanks
    // never overwrite what's on file.
    const contact = emergencyContactSchema.safeParse(Object.fromEntries(formData));
    if (savedDraft && contact.success) {
      await saveBookingEmergencyContact(db, {
        shopId: record.shopId,
        bookingId: recordBookingId,
        name: contact.data.emergencyContactName,
        phone: contact.data.emergencyContactPhone,
      });
    }
    revalidateAndRedirect(
      `/waivers/${token}`,
      `/waivers/${token}${savedDraft ? "?saved=1" : "?error=unavailable"}`,
    );
  }

  async function completeAction(formData: FormData) {
    "use server";
    const ip = await clientIp();
    if (!checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction).allowed) {
      redirect(`/waivers/${token}?error=invalid`);
    }
    const parsed = completeSignatureSchema.safeParse(Object.fromEntries(formData));
    const answers = readMedicalAnswers(formData, questionnaire);
    if (!parsed.success || !answers) redirect(`/waivers/${token}?error=invalid`);
    const contact = emergencyContactSchema.safeParse(Object.fromEntries(formData));
    const outcome = await completeWaiver(await getDb(), token, {
      signerName: parsed.data.signerName,
      agreed: true,
      medicalAnswers: answers,
      // Optional — a diver who skips it still signs; blanks never clobber a
      // value already on file.
      emergencyContact: contact.success
        ? {
            name: contact.data.emergencyContactName,
            phone: contact.data.emergencyContactPhone,
          }
        : undefined,
    });
    if (!outcome.ok) {
      redirect(
        `/waivers/${token}?error=${outcome.reason === "invalid_signature" ? "invalid" : "unavailable"}`,
      );
    }
    await trackEvent({ name: "waiver_signed" });
    revalidateAndRedirect(`/waivers/${token}`, `/waivers/${token}`);
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
      <FlashParams params={["saved", "error"]} />
      <header>
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shopName}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
          {t("waiver.beforeDockTitle")}
        </h1>
        <p className="mt-2 text-base text-muted">{t("waiver.beforeDockDescription")}</p>
      </header>

      {saved ? (
        <p
          role="status"
          className="mt-6 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success"
        >
          {t("waiver.progressSaved")}
        </p>
      ) : null}
      {errorText ? (
        <p
          role="alert"
          className="mt-6 rounded-lg bg-danger/10 px-4 py-3 text-sm font-medium text-danger"
        >
          {errorText}
        </p>
      ) : null}

      <section className="mt-8 rounded-lg border border-border bg-surface p-5">
        <p className="text-sm font-medium text-muted">
          {record.templateTitle} · version {record.templateVersion}
        </p>
        <div className="mt-3 whitespace-pre-wrap text-base leading-7">{record.templateBody}</div>
      </section>

      <form action={completeAction} className="mt-8 flex flex-col gap-6">
        <section>
          <h2 className="text-lg font-semibold">{questionnaire.title}</h2>
          <p className="mt-1 text-sm text-muted">{questionnaire.intro}</p>
          <div className="mt-4 flex flex-col gap-3">
            {questionnaire.questions.map((question) => (
              <RadioQuestion
                key={question.id}
                name={`q_${question.id}`}
                yes={draftResponses?.[question.id]}
                question={question.prompt}
              />
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold">{t("waiver.emergencyContact")}</h2>
          <p className="mt-1 text-sm text-muted">{t("waiver.emergencyContactDescription")}</p>
          <FieldGrid columns={2} className="mt-4">
            <Field label={t("waiver.contactName")}>
              <input
                name="emergencyContactName"
                autoComplete="name"
                maxLength={120}
                defaultValue={emergencyContact?.name ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label={t("waiver.contactPhone")}>
              <input
                name="emergencyContactPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={40}
                defaultValue={emergencyContact?.phone ?? ""}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold">{t("waiver.signature")}</h2>
          <FieldGrid columns={1} className="mt-4">
            <Field label={t("waiver.typeFullName")}>
              <input
                name="signerName"
                autoComplete="name"
                maxLength={120}
                defaultValue={record.draftSignerName ?? ""}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <label className="mt-4 flex min-h-11 items-center gap-3 text-base">
            <input
              name="acknowledged"
              type="checkbox"
              value="on"
              defaultChecked={record.draftAcknowledged}
              className="size-4 accent-primary"
            />
            <span>{t("waiver.agreementCheckbox")}</span>
          </label>
          <p className="mt-3 text-sm text-muted">{t("waiver.signatureNote")}</p>
        </section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="submit"
            formAction={saveDraftAction}
            className={buttonClass({
              variant: "secondary",
              className: `text-(color:--color-foreground) ${labelTextBase}`,
            })}
          >
            {t("waiver.saveForLater")}
          </button>
          <SubmitButton
            pendingLabel={t("waiver.signing")}
            className={buttonClass({
              size: "lg",
              className: `disabled:opacity-70 ${labelTextBase}`,
            })}
          >
            {t("waiver.signButton")}
          </SubmitButton>
        </div>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        {t("waiver.needHelp")}{" "}
        <Link href="/" className="font-medium text-primary hover:underline">
          {t("waiver.returnToShop")}
        </Link>{" "}
        {t("waiver.returnToShopSuffix")}
      </p>
    </main>
  );
}

function Unavailable({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <section className="rounded-lg border border-border bg-surface p-7 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-muted">{text}</p>
      </section>
    </main>
  );
}
