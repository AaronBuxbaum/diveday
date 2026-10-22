"use server";

import { shopAssist } from "@/db/assist-shop";
import { canPersonConfigureTrips } from "@/db/authz";
import { courseWords, tripWords } from "@/db/content-assists";
import type { DiveSpecialty } from "@/db/schema";
import { saveTranslation, translatableOriginal } from "@/db/shop-text-translations";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { BENCH_NOTE_FEATURE, benchNote, benchNoteCall } from "@/lib/assists/bench-note";
import {
  DESCRIPTION_DRAFT_FEATURE,
  type DescriptionFacts,
  descriptionDraft,
  descriptionDraftCall,
} from "@/lib/assists/description-draft";
import {
  isTranslatable,
  SHOP_TRANSLATE_FEATURE,
  shopTranslateCall,
  shopTranslation,
  sourceDigest,
  type TranslatableKind,
  translationBoxId,
  translationSourceId,
} from "@/lib/assists/shop-translate";
import { SITE_BRIEF_FEATURE, siteBrief, siteBriefCall } from "@/lib/assists/site-brief";
import type { CertificationLevel } from "@/lib/certification-levels";
import { parseRequirement, type Requirement } from "@/lib/requirement";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

/**
 * The content assists' server actions: each takes the form's current words,
 * answers values for its boxes (or null), and writes nothing, except the
 * Spanish save, which is the staffer's own Save on their own words. Every one
 * reads and writes only the session's shop.
 *
 * - **copywriter**: a trip description or a course summary, and its Spanish.
 * - **site-brief**: a dive site's description and marine-life paragraph.
 * - **shop-translate**: one field's Spanish, and saving it.
 * - **bench**: a work order's customer-facing "work performed" line.
 */

/** The gate each kind's own edit form takes, so a draft or a save is never wider than the edit. */
async function surfaceFor(shopSlug: string, kind: TranslatableKind) {
  return kind === "trip"
    ? requireShopSurface(shopSlug, {
        allow: canPersonConfigureTrips,
        refusal: { notice: "not-authorized", landing: ["trips"] },
      })
    : requireShopSurface(shopSlug);
}

/** A short single-line word from a form box, or undefined for a blank one. */
function word(
  form: Record<string, string> | undefined,
  key: string,
  max = 200,
): string | undefined {
  const value = typeof form?.[key] === "string" ? form[key].trim() : "";
  return value ? value.slice(0, max) : undefined;
}

/** A whole number a box holds, formatted, or undefined. */
function count(form: Record<string, string> | undefined, key: string): string | undefined {
  const value = word(form, key, 12);
  return value && /^\d{1,6}(\.\d{1,2})?$/.test(value) ? value : undefined;
}

/**
 * The record's requirement as labelled words for a draft's context
 * (`minCert`, `specialties`, `nitrox`). A draft is never allowed to restate
 * it (`claimsAnAudience`): it is sent so the model has no reason to guess.
 */
function requirementWords(locale: string, requirement: Requirement): Record<string, string> {
  const t = staffTranslator(locale);
  const level = requirement.minimumCertificationLevel;
  return defined({
    minCert: level ? t(CERTIFICATION_LEVEL_KEYS[level]) : undefined,
    specialties:
      requirement.requiredSpecialties.map((specialty) => t(SPECIALTY_KEYS[specialty])).join(", ") ||
      undefined,
    nitrox: requirement.requiresNitrox ? t("deskAssists.requirement.nitrox") : undefined,
  });
}

/** A site form's requirement boxes, unsaved: the level select, the repeated `specialty` boxes (joined) and nitrox. */
function formRequirement(form: Record<string, string>): Requirement {
  const level = word(form, "minimumCertificationLevel", 40);
  const specialties = (word(form, "specialty", 200) ?? "").split(",").filter(Boolean);
  return parseRequirement({
    minimumCertificationLevel:
      level && level in CERTIFICATION_LEVEL_KEYS ? (level as CertificationLevel) : null,
    requiredSpecialties: specialties.filter(
      (value): value is DiveSpecialty => value in SPECIALTY_KEYS,
    ),
    requiresNitrox: Boolean(form.requiresNitrox),
  });
}

function defined<T extends Record<string, string | undefined>>(record: T): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export async function draftTripDescriptionAction(
  shopSlug: string,
  rawTripId: string,
  form: Record<string, string>,
): Promise<Record<string, string> | null> {
  const tripId = uuidParam(rawTripId);
  if (!tripId) return null;
  const { db, shop } = await surfaceFor(shopSlug, "trip");
  const record = await tripWords(db, shop.id, tripId);
  if (!record) return null;
  const input: DescriptionFacts = {
    kind: "trip",
    locale: shop.defaultLocale,
    words: defined({
      title: word(form, "title", 120) ?? record.trip.title,
      sites: record.sites.join(", ") || undefined,
      mode: record.trip.diveMode ?? undefined,
      meetingPoint: word(form, "meetingPointLabel", 120),
    }),
    requirement: requirementWords(shop.defaultLocale, record.requirement),
    facts: defined({
      dives: record.dives > 0 ? String(record.dives) : undefined,
      seats: count(form, "capacity"),
    }),
  };
  const draft = descriptionDraft(
    await shopAssist(db, {
      shopId: shop.id,
      feature: DESCRIPTION_DRAFT_FEATURE,
      call: descriptionDraftCall(input),
    }),
    input,
  );
  if (!draft) return null;
  return defined({
    description: draft.primary,
    [`#${translationBoxId("trip", tripId, "description")}`]: draft.spanish ?? undefined,
    [`#${translationSourceId(translationBoxId("trip", tripId, "description"))}`]: draft.spanish
      ? sourceDigest(draft.primary)
      : undefined,
  });
}

export async function draftCourseSummaryAction(
  shopSlug: string,
  rawCourseId: string,
  form: Record<string, string>,
): Promise<Record<string, string> | null> {
  const courseId = uuidParam(rawCourseId);
  if (!courseId) return null;
  const { db, shop } = await surfaceFor(shopSlug, "course");
  const course = await courseWords(db, shop.id, courseId);
  if (!course) return null;
  const input: DescriptionFacts = {
    kind: "course",
    locale: shop.defaultLocale,
    words: defined({
      title: word(form, "title", 120) ?? course.title,
      agency: course.agency,
      // The overview's prose, digits removed: its numbers are not facts the
      // summary may restate, since nothing here can check them.
      overview:
        (word(form, "overview", 1_200) ?? course.overview ?? "").replace(/\d+/g, "").trim() ||
        undefined,
    }),
    requirement: requirementWords(shop.defaultLocale, course.requirement),
    facts: {},
  };
  const draft = descriptionDraft(
    await shopAssist(db, {
      shopId: shop.id,
      feature: DESCRIPTION_DRAFT_FEATURE,
      call: descriptionDraftCall(input),
    }),
    input,
  );
  if (!draft) return null;
  return defined({
    summary: draft.primary,
    [`#${translationBoxId("course", courseId, "summary")}`]: draft.spanish ?? undefined,
    [`#${translationSourceId(translationBoxId("course", courseId, "summary"))}`]: draft.spanish
      ? sourceDigest(draft.primary)
      : undefined,
  });
}

export async function draftSiteBriefAction(
  shopSlug: string,
  form: Record<string, string>,
): Promise<Record<string, string> | null> {
  const { db, shop } = await requireShopSurface(shopSlug);
  const unit = shop.depthUnit === "feet" ? "ft" : "m";
  const depth = (key: string) => {
    const value = count(form, key);
    return value ? `${value} ${unit}` : undefined;
  };
  const minutes = count(form, "expectedBottomTime");
  const input = {
    locale: shop.defaultLocale,
    words: defined({
      name: word(form, "name", 120),
      location: word(form, "locationName", 120),
      difficulty: word(form, "difficulty", 40),
      creatures: word(form, "marineLife", 400),
      current: word(form, "currentNote", 300),
      plan: word(form, "divePlan", 600),
    }),
    requirement: requirementWords(shop.defaultLocale, formRequirement(form)),
    facts: defined({
      minDepth: depth("minDepth"),
      maxDepth: depth("maxDepth"),
      bottomTime: minutes ? `${minutes} min` : undefined,
    }),
  };
  if (!input.words.name) return null;
  const brief = siteBrief(
    await shopAssist(db, {
      shopId: shop.id,
      feature: SITE_BRIEF_FEATURE,
      call: siteBriefCall(input),
    }),
    input,
  );
  if (!brief) return null;
  return defined({
    description: brief.description,
    marineLifeDescription: brief.marineLifeDescription ?? undefined,
  });
}

export async function draftTranslationAction(
  shopSlug: string,
  kind: string,
  rawId: string,
  field: string,
): Promise<Record<string, string> | null> {
  const id = uuidParam(rawId);
  if (!id || !isTranslatable(kind, field)) return null;
  const { db, shop } = await surfaceFor(shopSlug, kind);
  const original = await translatableOriginal(db, shop.id, kind, id, field);
  if (!original?.trim()) return null;
  const text = shopTranslation(
    await shopAssist(db, {
      shopId: shop.id,
      feature: SHOP_TRANSLATE_FEATURE,
      call: shopTranslateCall(original),
    }),
    original,
  );
  // The box records which English it holds a translation of, so a save after
  // the English changed is refused rather than re-pinned (saveTranslation).
  return text ? { text, translatedFrom: sourceDigest(original) } : null;
}

export type TranslationSaveState = { status?: "saved" | "error" | "stale" };

export async function saveTranslationAction(
  shopSlug: string,
  kind: string,
  rawId: string,
  field: string,
  _prev: TranslationSaveState,
  formData: FormData,
): Promise<TranslationSaveState> {
  const id = uuidParam(rawId);
  if (!id || !isTranslatable(kind, field)) return { status: "error" };
  const { db, shop } = await surfaceFor(shopSlug, kind);
  const original = await translatableOriginal(db, shop.id, kind, id, field);
  if (original === null) return { status: "error" };
  const text = formData.get("text");
  const translatedFrom = formData.get("translatedFrom");
  const result = await saveTranslation(
    db,
    shop.id,
    { kind, id, field },
    {
      text: typeof text === "string" ? text : "",
      original,
      translatedFrom: typeof translatedFrom === "string" ? translatedFrom : "",
    },
  );
  return { status: result === "refused" ? "error" : result };
}

export async function draftBenchNoteAction(
  shopSlug: string,
  form: Record<string, string>,
): Promise<Record<string, string> | null> {
  const { db, shop } = await requireShopSurface(shopSlug);
  const input = {
    reportedProblem: word(form, "reportedProblem", 2_000) ?? "",
    technicianNotes: word(form, "technicianNotes", 4_000) ?? "",
    outcome: null,
    locale: shop.defaultLocale,
  };
  if (!input.technicianNotes) return null;
  const message = benchNote(
    await shopAssist(db, {
      shopId: shop.id,
      feature: BENCH_NOTE_FEATURE,
      call: benchNoteCall(input),
    }),
    input,
  );
  return message ? { workPerformed: message } : null;
}
