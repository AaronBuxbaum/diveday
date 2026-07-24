import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import type { MedicalAnswers } from "@/db/schema";
import { getShopById } from "@/db/shops";
import {
  completeWaiver,
  getEmergencyContactForBooking,
  getWaiverForToken,
  saveBookingEmergencyContact,
  saveWaiverDraft,
} from "@/db/waivers";
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
  const state = await getWaiverForToken(db, token);

  if (state.state === "unavailable") {
    return (
      <Unavailable
        title="This waiver link isn’t available"
        text="Ask your dive shop for a fresh link."
      />
    );
  }

  if (state.state === "expired") {
    return (
      <Unavailable
        title="This waiver link has expired"
        text="Ask your dive shop for a fresh link — no information was submitted."
      />
    );
  }

  const shop = await getShopById(db, state.record.shopId);
  if (!shop) {
    return (
      <Unavailable
        title="This waiver link isn’t available"
        text="Ask your dive shop for a fresh link."
      />
    );
  }
  const shopName = shop.name;
  if (state.state === "completed") {
    const needsReview = state.record.status === "medical_review";
    // The token knows its booking, so send them onward to their own readiness
    // page rather than dead-ending on the shop home — that's where the rest of
    // their pre-trip prep (payment, rentals, nitrox) lives. Minting a fresh
    // readiness capability here (rather than trying to recall a prior one) is
    // the same tradeoff issueBookingCapability always makes: only the hash of
    // an issued token is ever kept.
    const readyCapability = await issueBookingCapability(db, {
      shopId: state.record.shopId,
      bookingId: state.record.bookingId,
      purpose: "readiness",
    });
    const readyPath = readyCapability ? readinessLinkPath(readyCapability.token) : null;
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
        <section className="rise-in rounded-lg border border-accent/40 bg-accent/10 p-7">
          <p className="text-sm font-medium tracking-widest text-primary uppercase">{shopName}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {needsReview ? "Waiver received" : "That’s the paperwork done ✓"}
          </h1>
          <p className="mt-3 text-base text-muted">
            {needsReview
              ? "Thanks — a team member will privately review one of your answers before the trip. Please don’t assume you’re cleared until they confirm."
              : "Signed, saved, and off your mind. We’ll see you at the dock — your shop will let you know if anything else is needed."}
          </p>
          {readyPath ? (
            <Link href={readyPath} className={buttonClass({ className: "mt-5" })}>
              See what’s left before you sail
            </Link>
          ) : null}
        </section>
      </main>
    );
  }

  const { record } = state;
  const emergencyContact = await getEmergencyContactForBooking(db, record.bookingId);
  const questionnaire = questionnaireForJurisdiction(shop.jurisdiction);
  const draft = record.draftMedicalAnswers;
  /** Only pre-fill draft answers captured against this same questionnaire. */
  const draftResponses =
    draft && draft.questionnaireId === questionnaire.id ? draft.responses : undefined;
  const errorText =
    error === "invalid"
      ? "Please answer every question, type your full name, and confirm your agreement."
      : error === "unavailable"
        ? "That link is no longer active. Ask the shop for a fresh one."
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
        bookingId: record.bookingId,
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
    revalidateAndRedirect(`/waivers/${token}`, `/waivers/${token}`);
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
      <FlashParams params={["saved", "error"]} />
      <header>
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shopName}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
          A quick step before the dock
        </h1>
        <p className="mt-2 text-base text-muted">
          This private waiver takes about two minutes. You can save your place and come back on this
          link before it expires.
        </p>
      </header>

      {saved ? (
        <p
          role="status"
          className="mt-6 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success"
        >
          Your progress is saved. Finish whenever you’re ready.
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
          <h2 className="text-lg font-semibold">Emergency contact</h2>
          <p className="mt-1 text-sm text-muted">
            Someone we can reach for you on the day — optional, but it’s what the crew has if
            anything happens on the water.
          </p>
          <FieldGrid columns={2} className="mt-4">
            <Field label="Contact name">
              <input
                name="emergencyContactName"
                autoComplete="name"
                maxLength={120}
                defaultValue={emergencyContact?.name ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label="Contact phone">
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
          <h2 className="text-lg font-semibold">Your signature</h2>
          <FieldGrid columns={1} className="mt-4">
            <Field label="Type your full name">
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
            <span>I have read this waiver, understand it, and agree to it.</span>
          </label>
          <p className="mt-3 text-sm text-muted">
            Your typed name, agreement, and completion time are saved with this exact version of the
            waiver.
          </p>
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
            Save and finish later
          </button>
          <SubmitButton
            pendingLabel="Signing…"
            className={buttonClass({
              size: "lg",
              className: `disabled:opacity-70 ${labelTextBase}`,
            })}
          >
            Sign waiver
          </SubmitButton>
        </div>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        Need help?{" "}
        <Link href="/" className="font-medium text-primary hover:underline">
          Return to the shop
        </Link>{" "}
        and contact your dive team.
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
