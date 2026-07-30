import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { courseSlug } from "@/lib/courses";
import { type CertificationLevel, certificationMeets, certificationRank } from "@/lib/readiness";
import type { AppDb, DbExecutor } from "./client";
import { coursePathSteps, coursePaths, courses } from "./schema";

/** One rung as the builder posts it: a catalog course plus the shop's note. */
export type CoursePathStepInput = { courseId: string; note?: string | null };

export type NewCoursePath = {
  shopId: string;
  title: string;
  summary?: string | null;
  slug?: string;
  isActive?: boolean;
  steps?: CoursePathStepInput[];
};

export type CoursePathStep = {
  id: string;
  position: number;
  note: string | null;
  course: {
    id: string;
    title: string;
    slug: string;
    agency: string;
    isActive: boolean;
    minimumCertificationLevel: CertificationLevel | null;
    summary: string | null;
    priceCents: number | null;
  };
};

export type CoursePathWithSteps = typeof coursePaths.$inferSelect & { steps: CoursePathStep[] };

/**
 * Rewrites a path's rungs as one unit: every save from the builder posts the
 * whole ordered list, so the steps are deleted and re-inserted rather than
 * diffed. Positions come out dense and 0-based, which is what makes both
 * unique indexes on the table hold without a deferred constraint (a per-row
 * reorder would transiently collide).
 *
 * Only courses belonging to `shopId` survive the filter — a step pointing at
 * another tenant's course is dropped, not rejected, so a stale picker option
 * can never leak a cross-shop row into a path.
 */
async function replaceSteps(
  tx: DbExecutor,
  shopId: string,
  pathId: string,
  steps: CoursePathStepInput[],
): Promise<void> {
  await tx.delete(coursePathSteps).where(eq(coursePathSteps.pathId, pathId));
  if (steps.length === 0) return;

  const requested = [...new Set(steps.map((step) => step.courseId))];
  const owned = new Set(
    (
      await tx
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.shopId, shopId), inArray(courses.id, requested)))
    ).map((row) => row.id),
  );

  const seen = new Set<string>();
  const rows: (typeof coursePathSteps.$inferInsert)[] = [];
  for (const step of steps) {
    if (!owned.has(step.courseId) || seen.has(step.courseId)) continue;
    seen.add(step.courseId);
    rows.push({
      pathId,
      courseId: step.courseId,
      position: rows.length,
      note: step.note?.trim() || null,
    });
  }
  if (rows.length > 0) await tx.insert(coursePathSteps).values(rows);
}

/**
 * The insert without a transaction of its own, for callers that already hold
 * one — the seed runs inside the bootstrap transaction and cannot hand an
 * `AppDb` down. Prefer `createCoursePath` everywhere else.
 */
export async function insertCoursePath(tx: DbExecutor, input: NewCoursePath) {
  const title = input.title.trim();
  if (!title) return null;
  const [path] = await tx
    .insert(coursePaths)
    .values({
      shopId: input.shopId,
      title,
      slug: input.slug ?? courseSlug(title),
      summary: input.summary?.trim() || null,
      isActive: input.isActive ?? true,
    })
    .returning();
  if (!path) return null;
  await replaceSteps(tx, input.shopId, path.id, input.steps ?? []);
  return path;
}

export async function createCoursePath(db: AppDb, input: NewCoursePath) {
  return db.transaction((tx) => insertCoursePath(tx, input));
}

export type CoursePathPatch = {
  title: string;
  summary?: string | null;
  isActive?: boolean;
  steps: CoursePathStepInput[];
};

/**
 * Saves the builder's whole state in one transaction: the path's own fields and
 * its full rung list. The slug deliberately does *not* follow a retitle — it is
 * a published URL, and divers may already be holding a link to it.
 */
export async function updateCoursePath(
  db: AppDb,
  shopId: string,
  pathId: string,
  patch: CoursePathPatch,
): Promise<boolean> {
  const title = patch.title.trim();
  if (!title) return false;
  return db.transaction(async (tx) => {
    const [path] = await tx
      .update(coursePaths)
      .set({
        title,
        summary: patch.summary?.trim() || null,
        ...(patch.isActive === undefined ? {} : { isActive: patch.isActive }),
      })
      .where(and(eq(coursePaths.id, pathId), eq(coursePaths.shopId, shopId)))
      .returning({ id: coursePaths.id });
    if (!path) return false;
    await replaceSteps(tx, shopId, pathId, patch.steps);
    return true;
  });
}

/** Hard delete: a path holds no history worth archiving, and the steps cascade. */
export async function deleteCoursePath(db: AppDb, shopId: string, pathId: string) {
  const [path] = await db
    .delete(coursePaths)
    .where(and(eq(coursePaths.id, pathId), eq(coursePaths.shopId, shopId)))
    .returning({ id: coursePaths.id });
  return Boolean(path);
}

export async function setCoursePathVisibility(
  db: AppDb,
  shopId: string,
  pathId: string,
  visible: boolean,
) {
  const [path] = await db
    .update(coursePaths)
    .set({ isActive: visible })
    .where(and(eq(coursePaths.id, pathId), eq(coursePaths.shopId, shopId)))
    .returning({ id: coursePaths.id });
  return Boolean(path);
}

/** Every path in the shop with its rungs, hidden ones included (the builder's list). */
export async function listCoursePaths(
  db: AppDb,
  shopId: string,
  options: { activeOnly?: boolean } = {},
): Promise<CoursePathWithSteps[]> {
  const paths = await db
    .select()
    .from(coursePaths)
    .where(
      options.activeOnly
        ? and(eq(coursePaths.shopId, shopId), eq(coursePaths.isActive, true))
        : eq(coursePaths.shopId, shopId),
    )
    .orderBy(asc(coursePaths.title));
  if (paths.length === 0) return [];

  const byPath = await stepsForPaths(
    db,
    paths.map((path) => path.id),
  );
  return paths.map((path) => ({ ...path, steps: byPath.get(path.id) ?? [] }));
}

/** Ordered rungs for the given paths, joined to their courses, grouped by path. */
async function stepsForPaths(db: AppDb, pathIds: string[]): Promise<Map<string, CoursePathStep[]>> {
  const byPath = new Map<string, CoursePathStep[]>();
  if (pathIds.length === 0) return byPath;
  const rows = await db
    .select({ step: coursePathSteps, course: courses })
    .from(coursePathSteps)
    .innerJoin(courses, eq(courses.id, coursePathSteps.courseId))
    .where(inArray(coursePathSteps.pathId, pathIds))
    .orderBy(asc(coursePathSteps.position));

  for (const row of rows) {
    const list = byPath.get(row.step.pathId) ?? [];
    list.push({
      id: row.step.id,
      position: row.step.position,
      note: row.step.note,
      course: {
        id: row.course.id,
        title: row.course.title,
        slug: row.course.slug,
        agency: row.course.agency,
        isActive: row.course.isActive,
        minimumCertificationLevel: row.course.minimumCertificationLevel,
        summary: row.course.summary,
        priceCents: row.course.priceCents,
      },
    });
    byPath.set(row.step.pathId, list);
  }
  return byPath;
}

export async function getCoursePathBySlug(
  db: AppDb,
  shopId: string,
  slug: string,
): Promise<CoursePathWithSteps | null> {
  const [path] = await db
    .select()
    .from(coursePaths)
    .where(and(eq(coursePaths.shopId, shopId), eq(coursePaths.slug, slug)))
    .limit(1);
  if (!path) return null;
  // Just this path's rungs. Loading every path in the shop and picking one out
  // of the result was correct but read the whole catalog to render a single
  // builder page.
  return {
    ...path,
    steps: await stepsForPaths(db, [path.id]).then((byPath) => byPath.get(path.id) ?? []),
  };
}

/** Paths that contain a given course, for the "part of" note on its public page. */
export async function listPathsContainingCourse(db: AppDb, shopId: string, courseId: string) {
  const paths = await listCoursePaths(db, shopId, { activeOnly: true });
  return paths.filter((path) => path.steps.some((step) => step.course.id === courseId));
}

/**
 * The shop's own answer to "what should this diver do next?".
 *
 * A rung is a candidate when the diver could enrol in it today **and** its
 * admission bar stands at least as high as the card they already hold. Of those,
 * the highest-barred wins, ties going to the order the shop put its paths and
 * steps in. On an ordered ladder (Open Water → Advanced → Rescue) that lands
 * exactly on the rung above the diver's card, because each rung's gate is the
 * level below it.
 *
 * The second half of that rule is what keeps the suggestion honest. DiveDay
 * records the card a diver holds, never the courses they have *completed*, so
 * "have they done this already?" is not a question the data can answer. Reading
 * a rung whose bar the diver has already cleared as *done* is the conservative
 * guess: it can cost the shop a suggestion it might have made, where the other
 * direction sells a diver a course they finished last season. Saying nothing
 * beats being confidently wrong.
 *
 * Hidden courses are skipped: a path outlives a course the shop stops offering,
 * and pointing a diver at a page that 404s is worse than saying nothing.
 */
export function nextPathStep(
  paths: CoursePathWithSteps[],
  currentLevel: CertificationLevel | null,
): { path: CoursePathWithSteps; step: CoursePathStep } | null {
  // An uncertified diver sits below Open Water, which is rank 1 — rank 0 is the
  // floor a gateless course admits from.
  const heldRank = currentLevel ? certificationRank(currentLevel) : 0;
  let best: { path: CoursePathWithSteps; step: CoursePathStep; rank: number } | null = null;
  for (const path of paths) {
    for (const step of path.steps) {
      if (!step.course.isActive) continue;
      const gate = step.course.minimumCertificationLevel;
      if (gate && !(currentLevel && certificationMeets(currentLevel, gate))) continue;
      const gateRank = gate ? certificationRank(gate) : 0;
      if (gateRank < heldRank) continue; // already past this rung
      if (!best || gateRank > best.rank) best = { path, step, rank: gateRank };
    }
  }
  return best ? { path: best.path, step: best.step } : null;
}

/** Paths that still reference a course the shop has since hidden. */
export async function listPathsWithHiddenSteps(db: AppDb, shopId: string) {
  const paths = await listCoursePaths(db, shopId);
  return paths.filter((path) => path.steps.some((step) => !step.course.isActive));
}

/** Slug that does not collide with an existing path in the same shop. */
export async function uniquePathSlug(
  db: AppDb,
  shopId: string,
  title: string,
  excludePathId?: string,
): Promise<string> {
  const base = courseSlug(title);
  const taken = new Set(
    (
      await db
        .select({ slug: coursePaths.slug })
        .from(coursePaths)
        .where(
          excludePathId
            ? and(eq(coursePaths.shopId, shopId), ne(coursePaths.id, excludePathId))
            : eq(coursePaths.shopId, shopId),
        )
    ).map((row) => row.slug),
  );
  if (!taken.has(base)) return base;
  // Bounded by the unique index it exists to satisfy: `taken` holds at most
  // `taken.size` slugs, so one of `taken.size + 1` candidates is always free.
  for (let suffix = 2; suffix <= taken.size + 2; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}
