"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { DisclosureRow, DisclosureRowMessage } from "@/components/ui/disclosure";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { LEAD_TITLE_CLASS, SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { telHref } from "@/lib/contact-links";
import {
  COURSE_INQUIRY_EXPERIENCE,
  COURSE_INQUIRY_EXPERIENCE_KEYS,
  type CourseInquiryExperience,
  type DateRequestCopy,
  type InquiryFormState,
} from "@/lib/course-inquiry";

/**
 * "Get in touch and we will set one" used to be the end of the road: a diver
 * with no workable date was handed a sentence and left to write the email
 * themselves. This asks the questions a shop always ends up asking for and
 * turns them into a lead the desk can act on without a round trip.
 *
 * It stands on **two** surfaces now, which is why it lives here rather than in
 * the course folder it grew up in: a course page, where the request is about
 * the course whose URL it was sent from, and the schedule page, where a diver
 * who wants a two-tank on a Saturday nobody scheduled had no path at all. The
 * only difference between the two is `askInterest` — with no course in the URL,
 * the form has to ask what the request is *about*, because a row that names
 * neither is a request nobody can act on (the check constraint on
 * `course_inquiries` says the same thing in SQL).
 *
 * The dates are real `<input type="date">` fields, grouped with the free-text
 * flexible-timing answer: "any weekend in the autumn" is still a true answer,
 * and a date field cannot hold it. A preferred date with an alternate beside
 * it is a diver stating a range rather than booking a slot — nothing is held,
 * and the staff list at /shop/<shop>/requests is what makes the dates worth
 * collecting at all (it groups by them: "four people could make the 12th" is a
 * departure waiting to be scheduled).
 *
 * Submitting records the request server-side (a `course_inquiries` row, via
 * `submitRequest`) and best-effort notifies the shop's own inbox, so a diver on
 * a phone with no mail client configured no longer loses the lead entirely
 * (docs/product/archive/ux-personas-20260730-findings.md task 7).
 *
 * That is the only way to send it. The `mailto:` composer and the copy-the-
 * message button that stood beside it have gone: both handed the diver a draft
 * to send themselves, which is a worse outcome than the row this writes. The
 * shop's own address and phone number stay under the button as live links for
 * anyone who would rather write it themselves.
 *
 * `submitRequest` is bound to its shop (and course, when there is one) by the
 * page, so this component never carries the shop or course identity itself —
 * and so a test can hand it a stub without reaching through a server action's
 * module boundary. Called directly through `useTransition` rather than wired as
 * a `<form action>`: the composer builds its own `FormData` so the
 * required-field guards below can run first.
 */
export function DateRequestForm({
  submitRequest,
  askInterest = false,
  sectionId = "get-in-touch",
  contactEmail,
  contactPhone,
  collapsible = false,
  copy,
}: {
  submitRequest: (prevState: InquiryFormState, formData: FormData) => Promise<InquiryFormState>;
  /** True on the schedule page, where there is no course to be about. */
  askInterest?: boolean;
  sectionId?: string;
  /**
   * Null for a shop that has not filled its contact details in yet. The form
   * still renders and the request still lands in `course_inquiries` for staff
   * to read on the Requests page — only this line stands down. Guarding the
   * whole form on it switched off the one public conversion available to a
   * shop with nothing on the books (issue #710).
   */
  contactEmail: string | null;
  contactPhone: string | null;
  /** Collapse the low-frequency schedule request behind its own disclosure. */
  collapsible?: boolean;
  copy: DateRequestCopy;
}) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<InquiryFormState>({});
  const [interest, setInterest] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [alternateDate, setAlternateDate] = useState("");
  const [timing, setTiming] = useState("");
  // One diver is the answer far more often than any other, so it is the one
  // the box already holds — a diver bringing friends types over it, and nobody
  // has to fill in a field to say the obvious.
  const [diversInput, setDiversInput] = useState("1");
  const [experience, setExperience] = useState<CourseInquiryExperience | "">("");
  const [message, setMessage] = useState("");
  const [contactMissing, setContactMissing] = useState(false);
  const [interestMissing, setInterestMissing] = useState(false);

  const headingId = `${sectionId}-heading`;

  /**
   * What a submission requires before it is worth sending.
   *
   * Two things, and only two: what it is about (on the schedule page, where
   * nothing else says) and *some* way to answer them. Email or phone — either
   * one, never both — because a diver standing on a dock may only have one of
   * the two, but a lead with neither is a question nobody can reply to. The
   * experience answer is useful context for the shop, but never a gate.
   *
   * All are evaluated before returning, so a submission missing several shows
   * every refusal at once rather than one, then the next.
   */
  function requireAnswerable(): boolean {
    const hasInterest = !askInterest || Boolean(interest.trim());
    const hasContact = Boolean(email.trim() || phone.trim());
    setInterestMissing(!hasInterest);
    setContactMissing(!hasContact);
    return hasInterest && hasContact;
  }

  function sendRequest() {
    if (!requireAnswerable()) return;
    const formData = new FormData();
    if (askInterest && interest) formData.set("interest", interest);
    if (name) formData.set("name", name);
    if (email) formData.set("email", email);
    if (phone) formData.set("phone", phone);
    if (preferredDate) formData.set("preferredDate", preferredDate);
    if (alternateDate) formData.set("alternateDate", alternateDate);
    if (timing) formData.set("timing", timing);
    if (diversInput) formData.set("divers", diversInput);
    if (experience) formData.set("experience", experience);
    if (message) formData.set("message", message);
    startTransition(async () => {
      setState(await submitRequest({}, formData));
    });
  }

  /**
   * The shop's own address and number — the way out of the form, twice over.
   * Absent entirely for a shop with no contact details on file: an offer to
   * write to nobody is worse than no offer.
   *
   * **Either detail on its own is enough.** The first version hung the whole
   * line off the email address, so a shop with a phone number and no email —
   * an ordinary small dive shop, and the one most likely to want a call — had
   * its number silently dropped from the one place a diver is told what to do
   * when the date they wanted is not on the board. The docblock above already
   * claimed this was the behaviour; only the code disagreed.
   */
  const emailLink = contactEmail ? (
    <a href={`mailto:${contactEmail}`} className="font-medium text-primary hover:underline">
      {contactEmail}
    </a>
  ) : null;
  const phoneLink = contactPhone ? (
    <a href={telHref(contactPhone)} className="font-medium text-primary hover:underline">
      {contactPhone}
    </a>
  ) : null;
  const contactLine =
    emailLink || phoneLink ? (
      <p className="mt-4 text-sm text-muted">
        {emailLink ? (
          <>
            {copy.orWriteTo} {emailLink}
            {phoneLink ? (
              <>
                {" "}
                · {copy.callLabel} {phoneLink}
              </>
            ) : null}
          </>
        ) : (
          <>
            {copy.orCall} {phoneLink}
          </>
        )}
        .
      </p>
    ) : null;

  const body = state.success ? (
    <div className="rise-in mt-6 rounded-panel border border-border bg-surface-sunken p-6">
      <p className="font-semibold">{copy.sentHeading}</p>
      <p className="mt-2 text-sm text-muted">{copy.sentBody}</p>
      {contactLine}
    </div>
  ) : (
    <>
      <p className="mt-3 max-w-2xl text-muted">{copy.intro}</p>
      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div className="mt-6 max-w-3xl">
        <FieldGrid columns={2} className="content-start gap-y-5">
          {/* First, because on this surface it is the question: with no course
              in the URL, everything else is about *something* the shop cannot
              guess. */}
          {askInterest ? (
            <Field
              label={copy.whatToDive}
              hint={copy.required}
              className="sm:col-span-2"
              error={interestMissing ? t("inquiry.errors.interestRequired") : null}
            >
              <input
                name="interest"
                maxLength={200}
                value={interest}
                onChange={(event) => {
                  setInterest(event.target.value);
                  setInterestMissing(false);
                }}
                placeholder={copy.whatToDivePlaceholder}
                className={controlClass}
              />
            </Field>
          ) : null}
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
          {/* No `(optional)` on this one: the box opens holding **1** and that
              value is submitted whatever the diver does, so a qualifier saying
              it may be left blank describes a state the form cannot be in. */}
          <Field label={copy.howManyDivers}>
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
          {/* **One question, three ways to answer it**: a first choice, an
              alternative, or a flexible window. The fieldset is what makes it
              one question to a screen reader; what it was missing is the half a
              sighted reader gets, because the legend was set at exactly a
              `Field` label's size and weight and read as a fourth field name in
              a flat list of nine (issue #1314). It leads at the section size
              now, so the three answers below it are visibly *its* answers.

              The hint under it is gone rather than reworded: "Choose a
              preferred date, an alternative, or tell us when your timing is
              flexible" restated the three labels directly beneath it word for
              word, which is the caption AGENTS.md's copy-restraint rule
              deletes. Nothing about how the shop uses the dates was in it.

              `FieldGrid` rather than a hand-rolled `grid sm:grid-cols-2`: it is
              the wrapper the hard rule names, and its subgrid is what puts the
              two dates' captions and boxes on shared rows so the pair reads as
              a pair rather than as two boxes that happen to be adjacent. */}
          <fieldset className="sm:col-span-2">
            <legend className={SECTION_TITLE_CLASS}>{copy.dateOptionsHeading}</legend>
            <FieldGrid columns={2} className="mt-3 gap-y-5">
              <Field label={copy.preferredDate} hint={copy.optional}>
                <input
                  name="preferredDate"
                  type="date"
                  value={preferredDate}
                  onChange={(event) => setPreferredDate(event.target.value)}
                  className={controlClass}
                />
              </Field>
              <Field label={copy.alternateDate} hint={copy.optional}>
                <input
                  name="alternateDate"
                  type="date"
                  value={alternateDate}
                  onChange={(event) => setAlternateDate(event.target.value)}
                  className={controlClass}
                />
              </Field>
              <Field label={copy.whenSuits} hint={copy.optional} className="sm:col-span-2">
                <input
                  name="timing"
                  maxLength={200}
                  value={timing}
                  onChange={(event) => setTiming(event.target.value)}
                  placeholder={copy.whenSuitsPlaceholder}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
          </fieldset>
          <Field label={copy.whereYouAreUpTo} hint={copy.optional} className="sm:col-span-2">
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

        {/* One button, and then the shop's own details.
            "Open in your email app" and "Copy message" used to stand beside
            Send as equal secondary buttons, and both were escape hatches from
            a form that no longer needs one: Send records the request and
            notifies the shop, which is strictly more than a mailto can do — it
            composes a draft the diver still has to send themselves, from an app
            half of them have never configured on the phone they are holding,
            and DiveDay never learns whether it left. Three buttons also made
            the real one a third of the choice. A diver who would rather write it
            themselves still can: the line underneath is the shop's own address
            and phone number, both live links. */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={sendRequest}
            className={buttonClass()}
          >
            {pending ? copy.sending : copy.send}
          </button>
        </div>
        {contactLine}
      </div>
    </>
  );

  // Collapsed, this is one row of a group of asks rather than a section of its
  // own — the schedule page's tail, where it sits beside the deal list and the
  // "can't find your link" door. The row owns the heading (an `h3`, the group's
  // level) and the chevron, so nothing here spells either.
  if (collapsible) {
    // An answered row drops its disclosure, exactly as the deal list and the
    // find-my-link row beside it do. Left as a `DisclosureRow`, the chevron
    // would go on offering a form that no longer exists — and collapsing it
    // would hide the only thing telling the reader their request was sent.
    // The section branch below keeps the sunken inset instead: there the
    // confirmation replaces a body that was never collapsible.
    if (state.success) {
      return (
        <DisclosureRowMessage id={sectionId} heading={copy.sentHeading}>
          {copy.sentBody}
          {contactLine}
        </DisclosureRowMessage>
      );
    }
    return (
      <DisclosureRow id={sectionId} heading={copy.heading}>
        {body}
      </DisclosureRow>
    );
  }

  return (
    <section id={sectionId} aria-labelledby={headingId} className="mt-12 scroll-mt-8">
      <h2 id={headingId} className={LEAD_TITLE_CLASS}>
        {copy.heading}
      </h2>
      {body}
    </section>
  );
}
