"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import {
  COURSE_INQUIRY_EXPERIENCE,
  COURSE_INQUIRY_EXPERIENCE_KEYS,
  type CourseInquiryExperience,
  courseInquiryBody,
  courseInquiryMailto,
  courseInquirySubject,
  telHref,
} from "@/lib/course-inquiry";
import type { CourseInquiryFormState } from "../actions";

/** Keeps a typed number sane (no "0 divers", no "400 divers"); an empty box is left alone. */
function clampDivers(value: number): number {
  return Math.min(12, Math.max(1, Math.round(value)));
}

export interface CourseInquiryCopy {
  getInTouch: string;
  noDateBody: string;
  yourName: string;
  namePlaceholder: string;
  yourEmail: string;
  emailPlaceholder: string;
  yourPhone: string;
  phonePlaceholder: string;
  howManyDivers: string;
  optional: string;
  required: string;
  whenSuits: string;
  whenSuitsHint: string;
  whenSuitsPlaceholder: string;
  whereYouAreUpTo: string;
  chooseOne: string;
  anythingElse: string;
  messagePlaceholder: string;
  messageSoFar: string;
  openInEmailApp: string;
  copyMessage: string;
  copied: string;
  orWriteTo: string;
  callLabel: string;
  send: string;
  sending: string;
  sentHeading: string;
  sentBody: string;
}

/**
 * "Get in touch and we will set one" used to be the end of the road: a diver
 * with no workable date was handed a sentence and left to write the email
 * themselves. This writes it for them, and shows them exactly what they are
 * about to send before they send it — the preview is the point, because a
 * builder whose output you cannot see is a form you have to trust.
 *
 * Submitting records the inquiry server-side (a new `course_inquiries` row,
 * via `submitInquiry`) and best-effort notifies the shop's own inbox, so a
 * diver on a phone with no mail client configured no longer loses the lead
 * entirely (docs/product/archive/ux-personas-20260730-findings.md task 7). The
 * `mailto:` composer stays beside it as a fallback that needs no server
 * round trip at all — the message still leaves from the diver's own address
 * (src/lib/course-inquiry.ts explains why) for anyone who prefers that, or
 * if the server send is ever unavailable.
 *
 * `submitInquiry` is bound to its shop/course by the page (the same shape
 * RentalFitForm's own `action` prop takes) so this component never carries
 * the shop or course identity itself — and so a test can hand it a stub
 * without reaching through a server action's module boundary. Called
 * directly through `useTransition` rather than wired as a `<form action>`,
 * the same way WaitlistInvite.tsx drives its own server send — the composer
 * builds its own `FormData` so the required-field guard below can run first.
 */
export function CourseInquiry({
  submitInquiry,
  courseTitle,
  shopName,
  contactEmail,
  contactPhone,
  copy,
}: {
  submitInquiry: (
    prevState: CourseInquiryFormState,
    formData: FormData,
  ) => Promise<CourseInquiryFormState>;
  courseTitle: string;
  shopName: string;
  contactEmail: string;
  contactPhone: string | null;
  copy: CourseInquiryCopy;
}) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CourseInquiryFormState>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [timing, setTiming] = useState("");
  const [diversInput, setDiversInput] = useState("");
  const [experience, setExperience] = useState<CourseInquiryExperience | "">("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [experienceMissing, setExperienceMissing] = useState(false);

  // Optional, like every other contact field: blank is a real answer, not
  // something to snap back to a placeholder count.
  const divers = diversInput === "" ? null : clampDivers(Number(diversInput));
  const inquiry = { courseTitle, shopName, name, timing, divers, experience, message };
  const subject = courseInquirySubject(t, inquiry);
  const body = courseInquiryBody(t, inquiry);

  // The one field every submission path requires (task 8) — a diver reaching
  // for the mailto composer, the copy button, or the server-recorded send
  // all hit this first, because it is the field the shop reads before
  // anything else the diver typed.
  function requireExperience(): boolean {
    if (experience) {
      setExperienceMissing(false);
      return true;
    }
    setExperienceMissing(true);
    return false;
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      // Long enough to read, short enough that the button is ready again
      // before a diver who mis-copied reaches for it.
      setTimeout(() => setCopied(false), 4000);
    } catch {
      // A denied clipboard permission is not worth an error state: the mail
      // button beside it does the same job, and the message is on screen.
      setCopied(false);
    }
  }

  function sendInquiry() {
    if (!requireExperience()) return;
    const formData = new FormData();
    if (name) formData.set("name", name);
    if (email) formData.set("email", email);
    if (phone) formData.set("phone", phone);
    if (timing) formData.set("timing", timing);
    if (diversInput) formData.set("divers", diversInput);
    formData.set("experience", experience);
    if (message) formData.set("message", message);
    startTransition(async () => {
      setState(await submitInquiry({}, formData));
    });
  }

  if (state.success) {
    return (
      <section
        id="get-in-touch"
        aria-labelledby="get-in-touch-heading"
        className="mt-12 scroll-mt-8"
      >
        <h2 id="get-in-touch-heading" className="text-2xl font-semibold tracking-tight">
          {copy.getInTouch}
        </h2>
        <div className="rise-in mt-6 rounded-2xl border border-border bg-surface-sunken p-6">
          <p className="font-semibold">{copy.sentHeading}</p>
          <p className="mt-2 text-sm text-muted">{copy.sentBody}</p>
          <p className="mt-4 text-sm text-muted">
            {copy.orWriteTo}{" "}
            <a href={`mailto:${contactEmail}`} className="font-medium text-primary hover:underline">
              {contactEmail}
            </a>
            {contactPhone ? (
              <>
                {" "}
                · {copy.callLabel}{" "}
                <a
                  href={telHref(contactPhone)}
                  className="font-medium text-primary hover:underline"
                >
                  {contactPhone}
                </a>
              </>
            ) : null}
            .
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="get-in-touch" aria-labelledby="get-in-touch-heading" className="mt-12 scroll-mt-8">
      <h2 id="get-in-touch-heading" className="text-2xl font-semibold tracking-tight">
        {copy.getInTouch}
      </h2>
      <p className="mt-3 max-w-2xl text-muted">{copy.noDateBody}</p>
      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <FieldGrid columns={2} className="content-start gap-y-5">
          <Field label={copy.yourName} hint={copy.optional}>
            <input
              name="name"
              autoComplete="name"
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={copy.namePlaceholder}
              className={controlClass}
            />
          </Field>
          <Field label={copy.yourEmail} hint={copy.optional}>
            <input
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={200}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={copy.emailPlaceholder}
              className={controlClass}
            />
          </Field>
          <Field label={copy.yourPhone} hint={copy.optional}>
            <input
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={30}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder={copy.phonePlaceholder}
              className={controlClass}
            />
          </Field>
          <Field label={copy.howManyDivers} hint={copy.optional}>
            <input
              name="divers"
              type="number"
              min={1}
              max={12}
              value={diversInput}
              onChange={(event) => setDiversInput(event.target.value)}
              className={controlClass}
            />
          </Field>
          <Field label={copy.whenSuits} className="sm:col-span-2" description={copy.whenSuitsHint}>
            <input
              name="timing"
              maxLength={200}
              value={timing}
              onChange={(event) => setTiming(event.target.value)}
              placeholder={copy.whenSuitsPlaceholder}
              className={controlClass}
            />
          </Field>
          <Field label={copy.whereYouAreUpTo} hint={copy.required} className="sm:col-span-2">
            <select
              name="experience"
              required
              aria-required="true"
              aria-invalid={experienceMissing}
              value={experience}
              onChange={(event) => {
                setExperience(event.target.value as CourseInquiryExperience | "");
                setExperienceMissing(false);
              }}
              className={controlClass}
            >
              <option value="">{copy.chooseOne}</option>
              {COURSE_INQUIRY_EXPERIENCE.map((option) => (
                <option key={option} value={option}>
                  {t(COURSE_INQUIRY_EXPERIENCE_KEYS[option])}
                </option>
              ))}
            </select>
            {experienceMissing ? (
              <p role="alert" className="text-sm text-danger">
                {t("inquiry.errors.experienceRequired")}
              </p>
            ) : null}
          </Field>
          <Field label={copy.anythingElse} hint={copy.optional} className="sm:col-span-2">
            <textarea
              name="message"
              rows={4}
              maxLength={1500}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={copy.messagePlaceholder}
              className={controlClass}
            />
          </Field>
        </FieldGrid>

        <section
          aria-labelledby="inquiry-preview-heading"
          className="rounded-2xl border border-border bg-surface-sunken p-5"
        >
          <h3
            id="inquiry-preview-heading"
            className="text-xs font-semibold tracking-wide text-muted uppercase"
          >
            {copy.messageSoFar}
          </h3>
          <p className="mt-3 text-sm font-semibold">{subject}</p>
          <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-muted">{body}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending}
              aria-busy={pending}
              onClick={sendInquiry}
              className={buttonClass()}
            >
              {pending ? copy.sending : copy.send}
            </button>
            <a
              href={courseInquiryMailto(t, contactEmail, inquiry)}
              onClick={(event) => {
                if (!requireExperience()) event.preventDefault();
              }}
              className={buttonClass({ variant: "secondary", className: "text-foreground" })}
            >
              {copy.openInEmailApp}
            </a>
            <button
              type="button"
              onClick={() => {
                if (requireExperience()) copyMessage();
              }}
              className={buttonClass({ variant: "secondary", className: "text-foreground" })}
            >
              <span aria-live="polite">{copied ? copy.copied : copy.copyMessage}</span>
            </button>
          </div>
          <p className="mt-4 text-sm text-muted">
            {copy.orWriteTo}{" "}
            <a href={`mailto:${contactEmail}`} className="font-medium text-primary hover:underline">
              {contactEmail}
            </a>
            {contactPhone ? (
              <>
                {" "}
                · {copy.callLabel}{" "}
                <a
                  href={telHref(contactPhone)}
                  className="font-medium text-primary hover:underline"
                >
                  {contactPhone}
                </a>
              </>
            ) : null}
            .
          </p>
        </section>
      </div>
    </section>
  );
}
