"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
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

/** Keeps a typed number sane (no "0 divers", no "400 divers"); an empty box is left alone. */
function clampDivers(value: number): number {
  return Math.min(12, Math.max(1, Math.round(value)));
}

export interface CourseInquiryCopy {
  getInTouch: string;
  noDateBody: string;
  yourName: string;
  namePlaceholder: string;
  howManyDivers: string;
  optional: string;
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
}

/**
 * "Get in touch and we will set one" used to be the end of the road: a diver
 * with no workable date was handed a sentence and left to write the email
 * themselves. This writes it for them, and shows them exactly what they are
 * about to send before they send it — the preview is the point, because a
 * builder whose output you cannot see is a form you have to trust.
 *
 * The message leaves from the diver's own mail client (src/lib/course-inquiry.ts
 * explains why), so this component never posts anywhere and the page stays a
 * pure read for everyone who scrolls past it.
 */
export function CourseInquiry({
  courseTitle,
  shopName,
  contactEmail,
  contactPhone,
  copy,
}: {
  courseTitle: string;
  shopName: string;
  contactEmail: string;
  contactPhone: string | null;
  copy: CourseInquiryCopy;
}) {
  const t = useTranslations();
  const [name, setName] = useState("");
  const [timing, setTiming] = useState("");
  const [diversInput, setDiversInput] = useState("");
  const [experience, setExperience] = useState<CourseInquiryExperience | "">("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  // Optional, like every other contact field: blank is a real answer, not
  // something to snap back to a placeholder count.
  const divers = diversInput === "" ? null : clampDivers(Number(diversInput));
  const inquiry = { courseTitle, shopName, name, timing, divers, experience, message };
  const subject = courseInquirySubject(t, inquiry);
  const body = courseInquiryBody(t, inquiry);

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

  return (
    <section id="get-in-touch" aria-labelledby="get-in-touch-heading" className="mt-12 scroll-mt-8">
      <h2 id="get-in-touch-heading" className="text-2xl font-semibold tracking-tight">
        {copy.getInTouch}
      </h2>
      <p className="mt-3 max-w-2xl text-muted">{copy.noDateBody}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <FieldGrid columns={2} className="content-start gap-y-5">
          <Field label={copy.yourName}>
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
          <Field label={copy.whereYouAreUpTo} className="sm:col-span-2">
            <select
              name="experience"
              value={experience}
              onChange={(event) =>
                setExperience(event.target.value as CourseInquiryExperience | "")
              }
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
            <a href={courseInquiryMailto(t, contactEmail, inquiry)} className={buttonClass()}>
              {copy.openInEmailApp}
            </a>
            <button
              type="button"
              onClick={copyMessage}
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
