"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { copyToClipboard } from "@/components/Copyable";
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
  orPhone: string;
  orEmail: string;
  whenSuits: string;
  whenSuitsHint: string;
  whenSuitsPlaceholder: string;
  whereYouAreUpTo: string;
  chooseOne: string;
  anythingElse: string;
  messagePlaceholder: string;
  openInEmailApp: string;
  copyMessage: string;
  copied: string;
  copyFailed: string;
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
 * themselves. This asks the four questions a shop always ends up asking for
 * and turns them into a lead the desk can act on without a round trip.
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
  // One diver is the answer far more often than any other, so it is the one
  // the box already holds — a diver bringing friends types over it, and nobody
  // has to fill in a field to say the obvious.
  const [diversInput, setDiversInput] = useState("1");
  const [experience, setExperience] = useState<CourseInquiryExperience | "">("");
  const [message, setMessage] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [experienceMissing, setExperienceMissing] = useState(false);
  const [contactMissing, setContactMissing] = useState(false);

  // Cleared to blank is still a real answer — an emptied box means "I would
  // rather not say" and is never snapped back to the default.
  const divers = diversInput === "" ? null : clampDivers(Number(diversInput));
  const inquiry = {
    courseTitle,
    shopName,
    name,
    timing,
    divers,
    experience,
    message,
  };
  const subject = courseInquirySubject(t, inquiry);
  const body = courseInquiryBody(t, inquiry);

  /**
   * What every submission path requires, whichever button the diver reached
   * for — the mailto composer, the copy button, and the server-recorded send
   * all run this first.
   *
   * Two things: where the diver is up to, because it is the field the shop
   * reads before anything else they typed, and *some* way to answer them.
   * Email or phone — either one, never both — because a diver standing on a
   * dock may only have one of the two, but a lead with neither is a question
   * nobody can reply to.
   *
   * Both are evaluated before returning, so a submission missing both shows
   * both refusals at once rather than one, then the other.
   */
  function requireAnswerable(): boolean {
    const hasExperience = Boolean(experience);
    const hasContact = Boolean(email.trim() || phone.trim());
    setExperienceMissing(!hasExperience);
    setContactMissing(!hasContact);
    return hasExperience && hasContact;
  }

  async function copyMessage() {
    const ok = await copyToClipboard(`${subject}\n\n${body}`);
    setCopyStatus(ok ? "copied" : "failed");
    // Long enough to read, short enough that the button is ready again
    // before a diver who mis-copied reaches for it.
    setTimeout(() => setCopyStatus("idle"), 4000);
  }

  function sendInquiry() {
    if (!requireAnswerable()) return;
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

      <div className="mt-6 max-w-3xl">
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
          {/* Email and phone read as "(or phone)" / "(or email)" rather than
              "(optional)": neither is required on its own, but the pair is —
              the refusal below says so in words when both are left blank. */}
          <Field
            label={copy.yourEmail}
            hint={copy.orPhone}
            error={contactMissing ? t("inquiry.errors.contactRequired") : null}
          >
            <input
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={200}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setContactMissing(false);
              }}
              placeholder={copy.emailPlaceholder}
              className={controlClass}
            />
          </Field>
          <Field label={copy.yourPhone} hint={copy.orEmail}>
            <input
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={30}
              aria-invalid={contactMissing}
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setContactMissing(false);
              }}
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
          <Field
            label={copy.whenSuits}
            hint={copy.optional}
            description={copy.whenSuitsHint}
            className="sm:col-span-2"
          >
            <input
              name="timing"
              maxLength={200}
              value={timing}
              onChange={(event) => setTiming(event.target.value)}
              placeholder={copy.whenSuitsPlaceholder}
              className={controlClass}
            />
          </Field>
          <Field
            label={copy.whereYouAreUpTo}
            hint={copy.required}
            className="sm:col-span-2"
            error={experienceMissing ? t("inquiry.errors.experienceRequired") : null}
          >
            <select
              name="experience"
              required
              aria-required="true"
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

        {/* The buttons and the shop's own details, and nothing between them
            and the fields. There used to be a "your message so far" preview
            of the composed subject and body here; it showed a diver their own
            answers written back to them a second time, which is a paragraph to
            re-read rather than a fact to check. The composed message still
            goes to the mail app and the clipboard exactly as before — it just
            no longer occupies half the section on its way there. */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
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
              if (!requireAnswerable()) event.preventDefault();
            }}
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            {copy.openInEmailApp}
          </a>
          <button
            type="button"
            onClick={() => {
              if (requireAnswerable()) copyMessage();
            }}
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            <span aria-live="polite">
              {copyStatus === "copied"
                ? copy.copied
                : copyStatus === "failed"
                  ? copy.copyFailed
                  : copy.copyMessage}
            </span>
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
              <a href={telHref(contactPhone)} className="font-medium text-primary hover:underline">
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
