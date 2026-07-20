import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { getCourseBySlug, listCourses } from "@/db/courses";
import { formatFaqs, formatScheduleDays, isCoursePublishable } from "@/lib/courses";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";
import { saveCourseContentAction, setCoursePublishedAction } from "./actions";

export const metadata: Metadata = { title: "Edit course page — Scuba" };

const messages: Record<string, string> = {
  saved: "Course page saved.",
  imported: "Imported. Make it yours, then publish.",
  published: "Course page is live. Divers can read it and book a session.",
  unpublished: "Course page taken down. Scheduled sessions are unchanged.",
};
const errors: Record<string, string> = {
  invalid: "That didn’t save. Check the fields and try again.",
  images: "Use complete HTTP(S) links or /paths, one per line, up to eight.",
  upload: "That photo didn’t upload. Try a JPG, PNG, or WebP under 5 MB.",
  incomplete: "Add a subhead and either an overview or a day plan before publishing.",
};

export default async function EditCoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; slug: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, slug } = await params;
  const { notice, error } = await searchParams;
  const db = await getDb();
  const course = await getCourseBySlug(db, session.user.shopId, slug);
  if (!course) notFound();
  const catalog = (await listCourses(db, session.user.shopId)).filter(
    (entry) => entry.id !== course.id,
  );
  const back = `/shop/${shopSlug}/courses`;
  const publishable = isCoursePublishable(course);

  const saveAction = saveCourseContentAction.bind(null, shopSlug, slug);
  const publishAction = setCoursePublishedAction.bind(null, shopSlug, slug);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Link href={back} className="text-sm font-medium text-primary hover:underline">
        ← Courses
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow={course.agency.toUpperCase()}
          title={course.title}
          description="The page divers read before they book. Pricing and the prerequisite card are set on the course list."
          meta={
            <p className="text-sm text-muted">
              {course.isPublished ? "Live at " : "Will publish to "}
              <Link
                href={`/shop/${shopSlug}/courses/${slug}`}
                className="font-medium text-primary hover:underline"
              >
                /shop/{shopSlug}/courses/{slug}
              </Link>
            </p>
          }
          actions={
            <form action={publishAction}>
              <input type="hidden" name="published" value={course.isPublished ? "false" : "true"} />
              <SubmitButton
                pendingLabel="Saving…"
                disabled={!course.isPublished && !publishable}
                className={buttonClass({
                  variant: course.isPublished ? "secondary" : "primary",
                })}
              >
                {course.isPublished ? "Take page down" : "Publish page"}
              </SubmitButton>
            </form>
          }
        />
      </div>

      {notice && messages[notice] ? <ShopNotice>{messages[notice]}</ShopNotice> : null}
      {error && errors[error] ? (
        <ShopNotice tone="danger" role="alert">
          {errors[error]}
        </ShopNotice>
      ) : null}
      {!course.isPublished && !publishable ? (
        <ShopNotice tone="neutral">
          Draft. Add a subhead and either an overview or a day plan, then publish.
        </ShopNotice>
      ) : null}

      <form action={saveAction} className="mt-8 flex flex-col gap-6">
        <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
          <legend className="px-1 text-sm font-semibold">The pitch</legend>
          <FieldGrid columns={1} className="mt-3 gap-y-5">
            <Field
              label="Subhead"
              description="One line under the title, e.g. “How to become a PADI Open Water Diver”."
            >
              <input
                name="summary"
                maxLength={200}
                defaultValue={course.summary ?? ""}
                className={controlClass}
              />
            </Field>
            <Field
              label="Overview"
              hint="(optional)"
              description="A few paragraphs in the diver’s words, not the agency’s."
            >
              <textarea
                name="overview"
                rows={8}
                maxLength={6000}
                defaultValue={course.overview ?? ""}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
        </fieldset>

        <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
          <legend className="px-1 text-sm font-semibold">Photos</legend>
          <p className="mt-1 text-sm text-muted">
            Uploading adds a link to the gallery below. Remove a photo by deleting its line.
          </p>
          <FieldGrid columns={1} className="mt-4 gap-y-5">
            <Field label="Hero photo" hint="(replaces the current one)">
              <input
                name="heroImageFile"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                className={controlClass}
              />
            </Field>
            <Field label="Hero photo link">
              <input
                name="heroImageUrl"
                maxLength={2000}
                defaultValue={course.heroImageUrl ?? ""}
                placeholder="/courses/open-water.jpg"
                className={controlClass}
              />
            </Field>
            <Field label="Add gallery photos" hint="(up to eight in total)">
              <input
                name="galleryImageFiles"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/heic"
                className={controlClass}
              />
            </Field>
            <Field label="Gallery links" description="One link per line.">
              <textarea
                name="imageUrls"
                rows={4}
                maxLength={12000}
                defaultValue={course.imageUrls.join("\n")}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
        </fieldset>

        <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
          <legend className="px-1 text-sm font-semibold">At a glance</legend>
          <p className="mt-1 text-sm text-muted">
            The chips across the top of the page — how the course runs. Who may take it is the next
            box.
          </p>
          <FieldGrid columns={2} className="mt-4 gap-y-5">
            <Field label="Duration" hint="(optional)">
              <input
                name="durationText"
                maxLength={120}
                defaultValue={course.durationText ?? ""}
                placeholder="3 days · 8:15am–5:30pm"
                className={controlClass}
              />
            </Field>
            <Field label="Group size" hint="(optional)">
              <input
                name="groupSizeText"
                maxLength={120}
                defaultValue={course.groupSizeText ?? ""}
                placeholder="Max 5 students per instructor"
                className={controlClass}
              />
            </Field>
          </FieldGrid>
        </fieldset>

        <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
          <legend className="px-1 text-sm font-semibold">Who can enroll</legend>
          <p className="mt-1 text-sm text-muted">
            The one block on the page that answers “can I do this?”. The certification card is{" "}
            <strong className="font-medium text-foreground">
              {course.minimumCertificationLevel
                ? `${CERTIFICATION_LEVEL_LABELS[course.minimumCertificationLevel]} or higher`
                : "open to uncertified divers"}
            </strong>{" "}
            — set on the course list, shown here automatically. Your note appears under it, labelled
            as the shop talking, so it never reads as replacing the card the desk checks.
          </p>
          <FieldGrid columns={2} className="mt-4 gap-y-5">
            <Field
              label="Minimum age"
              hint="(optional)"
              description="The agency's, not yours — nothing at booking checks it."
            >
              <input
                name="minimumAge"
                type="number"
                min={8}
                max={99}
                defaultValue={course.minimumAge ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label="Prerequisite note" hint="(optional)">
              <input
                name="prerequisiteNote"
                maxLength={400}
                defaultValue={course.prerequisiteNote ?? ""}
                placeholder="Comfortable swimming 200 m"
                className={controlClass}
              />
            </Field>
          </FieldGrid>
        </fieldset>

        <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
          <legend className="px-1 text-sm font-semibold">What the fee covers</legend>
          <FieldGrid columns={2} className="mt-3 gap-y-5">
            <Field label="Included" description="One item per line.">
              <textarea
                name="includes"
                rows={6}
                maxLength={2000}
                defaultValue={course.includes.join("\n")}
                placeholder={"6 open water dives\nFull rental gear\nLight lunch"}
                className={controlClass}
              />
            </Field>
            <Field label="Not included" description="One item per line.">
              <textarea
                name="excludes"
                rows={6}
                maxLength={2000}
                defaultValue={course.excludes.join("\n")}
                placeholder={"Marine park fee\nHotel transfers"}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
        </fieldset>

        <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
          <legend className="px-1 text-sm font-semibold">Day by day</legend>
          <p className="mt-1 text-sm text-muted">
            One block per day, separated by a blank line. First line is the day and its hours, split
            by an em dash; the lines under it are what happens.
          </p>
          <FieldGrid columns={1} className="mt-4">
            <Field label="Day plan" hint="(optional)">
              <textarea
                name="scheduleDays"
                rows={12}
                maxLength={8000}
                defaultValue={formatScheduleDays(course.scheduleDays)}
                placeholder={
                  "Day 1 — 8:15am–5:30pm\nAcademics 1–2 and knowledge reviews\nConfined water skills\n\nDay 2 — 8:00am–4:00pm\nOpen water dives 1–2"
                }
                className={controlClass}
              />
            </Field>
          </FieldGrid>
        </fieldset>

        <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
          <legend className="px-1 text-sm font-semibold">Questions divers ask</legend>
          <p className="mt-1 text-sm text-muted">
            One block per question, separated by a blank line. First line is the question, the rest
            is the answer.
          </p>
          <FieldGrid columns={1} className="mt-4">
            <Field label="FAQ" hint="(optional)">
              <textarea
                name="faqs"
                rows={10}
                maxLength={12000}
                defaultValue={formatFaqs(course.faqs)}
                placeholder={
                  "Is equipment included?\nYes — mask, fins, wetsuit, BCD, regulator, and tanks.\n\nDo I need to be a strong swimmer?\nYou need to be comfortable in the water."
                }
                className={controlClass}
              />
            </Field>
          </FieldGrid>
        </fieldset>

        {catalog.length > 0 ? (
          <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
            <legend className="px-1 text-sm font-semibold">What to take next</legend>
            <p className="mt-1 text-sm text-muted">
              Cards at the foot of the page. Only published courses appear there.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {catalog.map((entry) => (
                <label
                  key={entry.id}
                  className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="relatedCourseIds"
                    value={entry.id}
                    defaultChecked={course.relatedCourseIds.includes(entry.id)}
                    className="size-4"
                  />
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  {entry.isPublished ? null : (
                    <span className="shrink-0 text-xs text-muted">draft</span>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Saving…" className={buttonClass()}>
            Save course page
          </SubmitButton>
          <Link
            href={`/shop/${shopSlug}/courses/${slug}`}
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            Preview
          </Link>
        </div>
      </form>
    </main>
  );
}
