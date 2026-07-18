import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/queries";
import type { MedicalAnswers } from "@/db/schema";
import { completeWaiver, getWaiverForToken, saveWaiverDraft } from "@/db/waivers";
import type { MedicalQuestionnaire } from "@/lib/medical";
import { questionnaireForJurisdiction } from "@/lib/medical";

export const metadata: Metadata = {
  title: "Complete your waiver — Scuba",
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
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
        <section className="rise-in rounded-lg border border-accent/40 bg-accent/10 p-7">
          <p className="text-sm font-medium tracking-widest text-primary uppercase">{shopName}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Waiver received</h1>
          <p className="mt-3 text-base text-muted">
            {needsReview
              ? "Thanks — a team member will privately review one of your answers before the trip. Please don’t assume you’re cleared until they confirm."
              : "You’re all set on the waiver. We’ll see you at the dock; your shop will let you know if anything else is needed."}
          </p>
        </section>
      </main>
    );
  }

  const { record } = state;
  const questionnaire = questionnaireForJurisdiction(shop.jurisdiction);
  const draft = record.draftMedicalAnswers;
  /** Only pre-fill draft answers captured against this same questionnaire. */
  const draftResponses =
    draft && draft.questionnaireId === questionnaire.id ? draft.responses : undefined;
  const inputClass =
    "min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal";
  const errorText =
    error === "invalid"
      ? "Please answer every question, type your full name, and confirm your agreement."
      : error === "unavailable"
        ? "That link is no longer active. Ask the shop for a fresh one."
        : undefined;

  async function saveDraftAction(formData: FormData) {
    "use server";
    const parsed = signatureSchema.safeParse(Object.fromEntries(formData));
    const answers = readMedicalAnswers(formData, questionnaire);
    if (!parsed.success || !answers) redirect(`/waivers/${token}?error=invalid`);
    const savedDraft = await saveWaiverDraft(await getDb(), token, {
      signerName: parsed.data.signerName,
      acknowledged: parsed.data.acknowledged === "on",
      medicalAnswers: answers,
    });
    redirect(`/waivers/${token}${savedDraft ? "?saved=1" : "?error=unavailable"}`);
  }

  async function completeAction(formData: FormData) {
    "use server";
    const parsed = completeSignatureSchema.safeParse(Object.fromEntries(formData));
    const answers = readMedicalAnswers(formData, questionnaire);
    if (!parsed.success || !answers) redirect(`/waivers/${token}?error=invalid`);
    const outcome = await completeWaiver(await getDb(), token, {
      signerName: parsed.data.signerName,
      agreed: true,
      medicalAnswers: answers,
    });
    if (!outcome.ok) {
      redirect(
        `/waivers/${token}?error=${outcome.reason === "invalid_signature" ? "invalid" : "unavailable"}`,
      );
    }
    redirect(`/waivers/${token}`);
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

      <ol
        className="mt-8 grid grid-cols-3 gap-2 text-center text-sm font-medium text-muted"
        aria-label="Waiver progress"
      >
        <li className="rounded-lg bg-primary/10 px-2 py-2 text-primary">1. Read</li>
        <li className="rounded-lg bg-surface-sunken px-2 py-2">2. Confirm</li>
        <li className="rounded-lg bg-surface-sunken px-2 py-2">3. Ready</li>
      </ol>

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
          <h2 className="text-lg font-semibold">Your signature</h2>
          <label className="mt-4 flex flex-col gap-1 text-base font-medium">
            Type your full name
            <input
              name="signerName"
              autoComplete="name"
              maxLength={120}
              defaultValue={record.draftSignerName ?? ""}
              className={inputClass}
            />
          </label>
          <label className="mt-4 flex min-h-11 items-start gap-3 text-base">
            <input
              name="acknowledged"
              type="checkbox"
              value="on"
              defaultChecked={record.draftAcknowledged}
              className="mt-1 size-4 accent-primary"
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
            className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-base font-medium transition-colors duration-200 hover:bg-surface-sunken"
          >
            Save and finish later
          </button>
          <SubmitButton
            pendingLabel="Signing…"
            className="min-h-11 rounded-lg bg-primary px-5 py-2.5 text-base font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover disabled:opacity-70"
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
