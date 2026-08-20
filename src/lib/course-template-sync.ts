import { z } from "zod";
import type { CourseContent } from "./courses";
import type { CertificationLevel } from "./readiness";

/**
 * Fields that a published course template owns. Media, prices, visibility, and
 * the public slug are deliberately absent: those belong to the shop and a
 * template update must not quietly replace them.
 */
export const COURSE_TEMPLATE_SYNC_FIELDS = [
  "title",
  "agency",
  "description",
  "minimumCertificationLevel",
  "minimumAge",
  "isIntroCourse",
  "summary",
  "overview",
  "durationText",
  "groupSizeText",
  "prerequisiteNote",
  "includes",
  "excludes",
  "scheduleDays",
  "faqs",
] as const;

/** The prose fields where a shop may have edited the template's starting words. */
export const COURSE_TEMPLATE_SHOP_EDITABLE_FIELDS = [
  "summary",
  "overview",
  "durationText",
  "groupSizeText",
  "prerequisiteNote",
  "includes",
  "excludes",
  "scheduleDays",
  "faqs",
] as const;

export type CourseTemplateField = (typeof COURSE_TEMPLATE_SYNC_FIELDS)[number];

/** The JSON-safe baseline stored when a course starts following a template. */
export type CourseTemplateSnapshot = {
  title: string;
  agency: string;
  description: string;
  minimumCertificationLevel: CertificationLevel | null;
  minimumAge: number | null;
  isIntroCourse: boolean;
  summary: string | null;
  overview: string | null;
  durationText: string | null;
  groupSizeText: string | null;
  prerequisiteNote: string | null;
  includes: string[];
  excludes: string[];
  scheduleDays: CourseContent["scheduleDays"];
  faqs: CourseContent["faqs"];
};

/** Structural shape accepted from the code-owned template module. */
export type CourseTemplateSource = {
  title: string;
  agency: string;
  description: string;
  minimumCertificationLevel: CertificationLevel | null;
  content: CourseContent;
};

/** Structural shape accepted from a database course row. */
export type CourseTemplateCourseRecord = Omit<CourseTemplateSnapshot, "description"> & {
  description: string | null;
};

export type CourseTemplateDiff = {
  field: CourseTemplateField;
  shopChanged: boolean;
  current: CourseTemplateSnapshot[CourseTemplateField];
  latest: CourseTemplateSnapshot[CourseTemplateField];
};

export type CourseTemplateUpdateMode = "preserve-shop-edits" | "replace-template-copy";

const certificationLevelSchema = z
  .union([
    z.literal("open_water"),
    z.literal("advanced_open_water"),
    z.literal("rescue"),
    z.literal("divemaster"),
    z.literal("instructor"),
  ])
  .nullable();

const scheduleDaySchema = z.object({
  title: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  timeNote: z.string().optional(),
  items: z.array(z.string()),
});

const courseTemplateSnapshotSchema = z.object({
  title: z.string(),
  agency: z.string(),
  description: z.string(),
  minimumCertificationLevel: certificationLevelSchema,
  minimumAge: z.number().int().nullable(),
  isIntroCourse: z.boolean(),
  summary: z.string().nullable(),
  overview: z.string().nullable(),
  durationText: z.string().nullable(),
  groupSizeText: z.string().nullable(),
  prerequisiteNote: z.string().nullable(),
  includes: z.array(z.string()),
  excludes: z.array(z.string()),
  scheduleDays: z.array(scheduleDaySchema),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
});

/** Convert the code-owned template into the baseline comparable to a course row. */
export function courseTemplateSnapshot(template: CourseTemplateSource): CourseTemplateSnapshot {
  return {
    title: template.title,
    agency: template.agency,
    description: template.description,
    minimumCertificationLevel: template.minimumCertificationLevel,
    minimumAge: template.content.minimumAge,
    isIntroCourse: template.content.isIntroCourse,
    summary: template.content.summary,
    overview: template.content.overview,
    durationText: template.content.durationText,
    groupSizeText: template.content.groupSizeText,
    prerequisiteNote: template.content.prerequisiteNote,
    includes: template.content.includes,
    excludes: template.content.excludes,
    scheduleDays: template.content.scheduleDays,
    faqs: template.content.faqs,
  };
}

/** Convert a database course row into the same shape without pulling the DB layer into lib. */
export function courseTemplateSnapshotFromCourse(
  course: CourseTemplateCourseRecord,
): CourseTemplateSnapshot {
  return {
    title: course.title,
    agency: course.agency,
    description: course.description ?? "",
    minimumCertificationLevel: course.minimumCertificationLevel,
    minimumAge: course.minimumAge,
    isIntroCourse: course.isIntroCourse,
    summary: course.summary,
    overview: course.overview,
    durationText: course.durationText,
    groupSizeText: course.groupSizeText,
    prerequisiteNote: course.prerequisiteNote,
    includes: course.includes,
    excludes: course.excludes,
    scheduleDays: course.scheduleDays,
    faqs: course.faqs,
  };
}

/** Parse stored JSON defensively; a malformed baseline disables syncing rather than guessing. */
export function parseCourseTemplateSnapshot(value: unknown): CourseTemplateSnapshot | null {
  const parsed = courseTemplateSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

/** Show only fields whose current shop value differs from the latest template. */
export function courseTemplateDiff(
  current: CourseTemplateSnapshot,
  baseline: CourseTemplateSnapshot | null,
  latest: CourseTemplateSnapshot,
): CourseTemplateDiff[] {
  return COURSE_TEMPLATE_SYNC_FIELDS.flatMap((field) => {
    const currentValue = current[field];
    const latestValue = latest[field];
    if (sameValue(currentValue, latestValue)) return [];
    return [
      {
        field,
        // A legacy course has no trustworthy baseline. The safe interpretation
        // is that every editable prose field belongs to the shop; source facts
        // remain source-owned and are still allowed to update explicitly.
        shopChanged: baseline
          ? !sameValue(currentValue, baseline[field])
          : COURSE_TEMPLATE_SHOP_EDITABLE_FIELDS.includes(
              field as (typeof COURSE_TEMPLATE_SHOP_EDITABLE_FIELDS)[number],
            ),
        current: currentValue,
        latest: latestValue,
      },
    ];
  });
}

/**
 * Preserve shop-edited prose by comparing it to the last imported baseline.
 * Replace mode intentionally takes every template-owned field from the new
 * source. Operational fields and media are never part of this result.
 */
export function mergedCourseTemplateSnapshot(
  current: CourseTemplateSnapshot,
  baseline: CourseTemplateSnapshot | null,
  latest: CourseTemplateSnapshot,
  mode: CourseTemplateUpdateMode,
): CourseTemplateSnapshot {
  if (mode === "replace-template-copy") return latest;

  const next = { ...latest };
  for (const field of COURSE_TEMPLATE_SHOP_EDITABLE_FIELDS) {
    if (!baseline || !sameValue(current[field], baseline[field])) {
      next[field] = current[field] as never;
    }
  }
  return next;
}

/** Fields that can be copied into the database without touching shop-owned media or operations. */
export function courseTemplateDatabaseFields(snapshot: CourseTemplateSnapshot) {
  return {
    title: snapshot.title,
    agency: snapshot.agency,
    description: snapshot.description || null,
    minimumCertificationLevel: snapshot.minimumCertificationLevel,
    minimumAge: snapshot.minimumAge,
    isIntroCourse: snapshot.isIntroCourse,
    summary: snapshot.summary,
    overview: snapshot.overview,
    durationText: snapshot.durationText,
    groupSizeText: snapshot.groupSizeText,
    prerequisiteNote: snapshot.prerequisiteNote,
    includes: snapshot.includes,
    excludes: snapshot.excludes,
    scheduleDays: snapshot.scheduleDays,
    faqs: snapshot.faqs,
  };
}
