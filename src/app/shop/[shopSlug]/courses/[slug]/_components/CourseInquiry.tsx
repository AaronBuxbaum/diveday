"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import {
  COURSE_INQUIRY_EXPERIENCE,
  courseInquiryBody,
  courseInquiryMailto,
  courseInquirySubject,
  telHref,
} from "@/lib/course-inquiry";

/** Keeps a typed number sane (no "0 divers", no "400 divers"); an empty box is left alone. */
function clampDivers(value: number): number {
  return Math.min(12, Math.max(1, Math.round(value)));
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
}: {
  courseTitle: string;
  shopName: string;
  contactEmail: string;
  contactPhone: string | null;
}) {
  const [name, setName] = useState("");
  const [timing, setTiming] = useState("");
  const [diversInput, setDiversInput] = useState("");
  const [experience, setExperience] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  // Optional, like every other contact field: blank is a real answer, not
  // something to snap back to a placeholder count.
  const divers = diversInput === "" ? null : clampDivers(Number(diversInput));
  const inquiry = { courseTitle, shopName, name, timing, divers, experience, message };
  const subject = courseInquirySubject(inquiry);
  const body = courseInquiryBody(inquiry);

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
        Get in touch
      </h2>
      <p className="mt-3 max-w-2xl text-muted">
        No date that works, or a question first? Answer what you can and we will write the email for
        you — it sends from your own mail app, so our reply lands where you expect it.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <FieldGrid columns={2} className="content-start gap-y-5">
          <Field label="Your name">
            <input
              name="name"
              autoComplete="name"
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Priya Sharma"
              className={controlClass}
            />
          </Field>
          <Field label="How many divers" hint="(optional)">
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
            label="When suits you"
            className="sm:col-span-2"
            description="Rough is fine — a month or “any weekend” tells us plenty."
          >
            <input
              name="timing"
              maxLength={200}
              value={timing}
              onChange={(event) => setTiming(event.target.value)}
              placeholder="The week of 12 August"
              className={controlClass}
            />
          </Field>
          <Field label="Where you are up to" className="sm:col-span-2">
            <select
              name="experience"
              value={experience}
              onChange={(event) => setExperience(event.target.value)}
              className={controlClass}
            >
              <option value="">Choose one</option>
              {COURSE_INQUIRY_EXPERIENCE.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Anything else" hint="(optional)" className="sm:col-span-2">
            <textarea
              name="message"
              rows={4}
              maxLength={1500}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="We are on a cruise and only ashore on Tuesday."
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
            Your message so far
          </h3>
          <p className="mt-3 text-sm font-semibold">{subject}</p>
          <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-muted">{body}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a href={courseInquiryMailto(contactEmail, inquiry)} className={buttonClass()}>
              Open in your email app
            </a>
            <button
              type="button"
              onClick={copyMessage}
              className={buttonClass({ variant: "secondary", className: "text-foreground" })}
            >
              <span aria-live="polite">{copied ? "Copied" : "Copy message"}</span>
            </button>
          </div>
          <p className="mt-4 text-sm text-muted">
            Or write to{" "}
            <a href={`mailto:${contactEmail}`} className="font-medium text-primary hover:underline">
              {contactEmail}
            </a>
            {contactPhone ? (
              <>
                {" "}
                · call{" "}
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
