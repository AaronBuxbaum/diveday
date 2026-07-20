import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { getCourseBySlug } from "@/db/courses";
import { formatFaqs, formatScheduleDays, isCoursePublishable } from "@/lib/courses";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";
import { saveCourseContentAction, setCoursePublishedAction } from "./actions";

export const metadata: Metadata = { title: "Edit course page — Scuba" };

const messages: Record<string, string> = {
  saved: "Course page saved.",
  published: "Course page is live. Divers can read it and book a session.",
  unpublished: "Course page hidden. Scheduled sessions are unchanged.",
};
const errors: Record<string, string> = {
  invalid: "That didn’t save. Check the fields and try again.",
  images: "You can keep up to eight gallery photos. Remove one before adding more.",
  upload: "That photo didn’t upload. Try a JPG, PNG, or WebP under 5 MB.",
  incomplete: "Add a subhead and either an overview or a day plan before publishing.",
};

const dollarsInput = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
const priceInputClass = `${controlClass} text-right tabular-nums`;

/** Course media comes from the shop's own uploads; render it as it was stored. */
function Thumb({ src, className }: { src: string; className: string }) {
  // biome-ignore lint/performance/noImgElement: course media comes from shop-provided hosts and the blob store, which no build-time image allowlist can enumerate.
  return <img src={src} alt="" className={className} />;
}

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
          description="Everything a diver reads before booking — the copy, the photos, and your pricing. The certification and minimum age come from the agency."
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
                {course.isPublished ? "Hide" : "Publish page"}
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
          <legend className="px-1 text-sm font-semibold">Pricing</legend>
          <p className="mt-1 text-sm text-muted">
            Two lines on one bill: your instruction fee and the agency’s e-learning code. The diver
            pays the total in a single payment.
          </p>
          <FieldGrid columns={2} className="mt-4 gap-y-5">
            <Field label="Instruction fee" hint="(optional)">
              <input
                name="price"
                inputMode="decimal"
                defaultValue={dollarsInput(course.priceCents)}
                placeholder="—"
                className={priceInputClass}
              />
            </Field>
            <Field label="e-Learning fee" hint="(its own invoice line)">
              <input
                name="eLearningPrice"
                inputMode="decimal"
                defaultValue={dollarsInput(course.eLearningPriceCents)}
                placeholder="—"
                className={priceInputClass}
              />
            </Field>
          </FieldGrid>
        </fieldset>

        <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
          <legend className="px-1 text-sm font-semibold">Photos</legend>
          <p className="mt-1 text-sm text-muted">
            Upload your own photos. New files are added to the gallery; tick a photo to remove it.
          </p>
          <FieldGrid columns={1} className="mt-4 gap-y-5">
            <Field label="Hero photo" hint="(the wide one at the top)">
              {course.heroImageUrl ? (
                <div className="mb-2 flex items-center gap-3">
                  <Thumb
                    src={course.heroImageUrl}
                    className="h-16 w-24 rounded-lg border border-border object-cover"
                  />
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" name="removeHero" value="true" className="size-4" />
                    Remove current photo
                  </label>
                </div>
              ) : null}
              <input
                name="heroImageFile"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                className={controlClass}
              />
            </Field>
            <Field label="Gallery photos" hint="(up to eight in total)">
              {course.imageUrls.length > 0 ? (
                <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {course.imageUrls.map((url) => (
                    <div key={url}>
                      <Thumb
                        src={url}
                        className="h-24 w-full rounded-lg border border-border object-cover"
                      />
                      <label className="mt-1 flex items-center gap-2 text-xs text-muted">
                        <input
                          type="checkbox"
                          name="removeGalleryUrls"
                          value={url}
                          className="size-4"
                        />
                        Remove
                      </label>
                    </div>
                  ))}
                </div>
              ) : null}
              <input
                name="galleryImageFiles"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/heic"
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
            The one block on the page that answers “can I do this?”. The certification and minimum
            age are the agency’s{" "}
            <strong className="font-medium text-foreground">
              {course.minimumCertificationLevel
                ? `${CERTIFICATION_LEVEL_LABELS[course.minimumCertificationLevel]} or higher`
                : "open to uncertified divers"}
              {course.minimumAge ? `, ${course.minimumAge}+` : ""}
            </strong>{" "}
            — shown here automatically and not editable. Your note appears under them, labelled as
            the shop talking, so it never reads as replacing the card the desk checks.
          </p>
          <FieldGrid columns={1} className="mt-4 gap-y-5">
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
