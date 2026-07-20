// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import {
  archiveCourse,
  createCourse,
  getCourseBySlug,
  importGlobalCourseTemplate,
  listActiveCourses,
  listGlobalCourseTemplates,
  listPublishedCourses,
  listRelatedCourses,
  setCoursePublished,
  setCourseVisibility,
  updateCourse,
  updateCourseContent,
} from "./courses";
import {
  courses,
  globalCourses,
  globalCourseVersions,
  tripAssignments,
  tripRequirements,
} from "./schema";
import {
  createTrip,
  getTripWithBooked,
  listStaff,
  listUpcomingSessionsForCourse,
  upcomingTripsWithCounts,
} from "./trips";

async function courseContext() {
  const { db, shop } = await seededShopContext();
  const sessions = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const discover = sessions.find((session) => session.course?.title === "Discover Scuba Diving");
  if (!discover) throw new Error("discover session missing");
  return { db, shop, discover };
}

describe("course catalog and sessions (in-memory PGlite)", () => {
  it("admits an uncertified participant to an instructor-staffed Discover Scuba session", async () => {
    const { db, shop, discover } = await courseContext();
    const outcome = await createBooking(db, {
      shopId: shop.id,
      tripId: discover.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    expect(outcome).toMatchObject({ ok: true, personName: "Nora Quinn" });
  });

  it("fails closed when an instructor-led session loses its instructor", async () => {
    const { db, shop, discover } = await courseContext();
    await db.delete(tripAssignments).where(eq(tripAssignments.tripId, discover.id));
    await expect(
      createBooking(db, {
        shopId: shop.id,
        tripId: discover.id,
        fullName: "Nora Quinn",
        email: "nora@example.com",
      }),
    ).resolves.toEqual({ ok: false, reason: "course_unstaffed" });
  });

  it("inherits an Advanced course baseline and requires a verified Open Water card at enrollment", async () => {
    const { db, shop } = await courseContext();
    const course = await createCourse(db, {
      shopId: shop.id,
      title: "Advanced Open Water — Weekend",
      minimumCertificationLevel: "open_water",
    });
    if (!course) throw new Error("course not created");
    const session = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Advanced Open Water — July weekend",
      startsAt: new Date("2030-07-20T13:00:00.000Z"),
      endsAt: new Date("2030-07-20T17:00:00.000Z"),
      capacity: 4,
    });
    if (!session) throw new Error("session not created");
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("instructor missing");
    await db.insert(tripAssignments).values({ tripId: session.id, personId: instructor.person.id });

    const stored = await getTripWithBooked(db, shop.id, session.id);
    expect(stored?.course?.id).toBe(course.id);

    await expect(
      createBooking(db, {
        shopId: shop.id,
        tripId: session.id,
        fullName: "Nora Quinn",
        email: "nora@example.com",
      }),
    ).resolves.toEqual({ ok: false, reason: "course_prerequisite" });

    await expect(
      createBooking(db, {
        shopId: shop.id,
        tripId: session.id,
        fullName: "Priya Sharma",
        email: "priya.sharma@example.com",
      }),
    ).resolves.toMatchObject({ ok: true, personName: "Priya Sharma" });

    const active = await listActiveCourses(db, shop.id);
    expect(active.map((entry) => entry.title)).toContain("Advanced Open Water — Weekend");

    // A shop edits its own blurb and its two prices; the agency owns the rest,
    // so an update never rewrites the title or the prerequisite card.
    const updated = await updateCourse(db, shop.id, course.id, {
      description: "Updated catalog copy",
      priceCents: 49900,
      eLearningPriceCents: 21000,
    });
    expect(updated).toMatchObject({
      title: "Advanced Open Water — Weekend",
      minimumCertificationLevel: "open_water",
      description: "Updated catalog copy",
      priceCents: 49900,
      eLearningPriceCents: 21000,
    });
    expect(await archiveCourse(db, shop.id, course.id)).toBe(true);
    expect((await listActiveCourses(db, shop.id)).some((entry) => entry.id === course.id)).toBe(
      false,
    );
    expect((await setCourseVisibility(db, shop.id, course.id, true))?.isActive).toBe(true);
  });

  it("schedules an entry-level course session with no cert gate, and an ordinary trip with one", async () => {
    const { db, shop } = await seededShopContext();
    // Open to uncertified divers — that is the point of the course, and the
    // session must not inherit the shop's default Open Water gate.
    const discover = await createCourse(db, {
      shopId: shop.id,
      title: "Try Scuba — evening",
      minimumCertificationLevel: null,
    });
    if (!discover) throw new Error("course not created");
    const session = await createTrip(db, {
      shopId: shop.id,
      courseId: discover.id,
      title: "Try Scuba — Thursday evening",
      startsAt: new Date("2030-08-01T22:00:00.000Z"),
      endsAt: new Date("2030-08-02T01:00:00.000Z"),
      capacity: 4,
    });
    if (!session) throw new Error("session not created");
    const [gate] = await db
      .select()
      .from(tripRequirements)
      .where(eq(tripRequirements.tripId, session.id));
    expect(gate?.minimumCertificationLevel).toBeNull();
    expect(gate?.requiresWaiver).toBe(true);

    const charter = await createTrip(db, {
      shopId: shop.id,
      title: "Two-tank reef charter",
      startsAt: new Date("2030-08-03T13:00:00.000Z"),
      endsAt: new Date("2030-08-03T17:00:00.000Z"),
      capacity: 8,
    });
    if (!charter) throw new Error("charter not created");
    const [charterGate] = await db
      .select()
      .from(tripRequirements)
      .where(eq(tripRequirements.tripId, charter.id));
    expect(charterGate?.minimumCertificationLevel).toBe("open_water");
  });
});

const emptyContent = {
  summary: null,
  overview: null,
  heroImageUrl: null,
  imageUrls: [],
  durationText: null,
  groupSizeText: null,
  minimumAge: null,
  prerequisiteNote: null,
  includes: [],
  excludes: [],
  scheduleDays: [],
  faqs: [],
};

/** A Scuba-published template a shop can import, at the given version. */
async function publishTemplate(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  overrides: {
    slug: string;
    version?: number;
    title?: string;
    summary?: string;
    minimumCertificationLevel?: "open_water" | null;
  },
) {
  const version = overrides.version ?? 1;
  const [template] = await db
    .insert(globalCourses)
    .values({ slug: overrides.slug, currentVersion: version })
    .returning();
  if (!template) throw new Error("template not created");
  await db.insert(globalCourseVersions).values({
    globalCourseId: template.id,
    version,
    title: overrides.title ?? "Sidemount Diver",
    agency: "padi",
    description: "Catalog blurb",
    minimumCertificationLevel: overrides.minimumCertificationLevel ?? "open_water",
    content: {
      ...emptyContent,
      summary: overrides.summary ?? "Dive two cylinders at your sides",
      includes: ["Two cylinders", "Sidemount harness"],
      scheduleDays: [{ title: "Day 1", timeRange: "9am–3pm", items: ["Confined water"] }],
    },
  });
  return template;
}

describe("course content and public pages (in-memory PGlite)", () => {
  it("saves the marketing page without touching pricing or the cert gate", async () => {
    const { db, shop } = await seededShopContext();
    const course = await createCourse(db, {
      shopId: shop.id,
      title: "Cavern Diver",
      priceCents: 32500,
      minimumCertificationLevel: "open_water",
    });
    if (!course) throw new Error("course not created");

    const saved = await updateCourseContent(db, shop.id, course.id, {
      ...emptyContent,
      summary: "Plan and make dives to 40 metres",
      overview: "Four training dives over two days.",
      durationText: "2 days",
      minimumAge: 15,
      includes: ["Four dives", "Tanks and weights"],
      scheduleDays: [{ title: "Day 1", timeRange: "8am–2pm", items: ["Dives 1–2"] }],
      faqs: [{ question: "Do I need a computer?", answer: "We rent one." }],
      relatedCourseIds: [],
    });
    expect(saved).toMatchObject({
      summary: "Plan and make dives to 40 metres",
      minimumAge: 15,
      priceCents: 32500,
      minimumCertificationLevel: "open_water",
    });
    expect(saved?.faqs).toEqual([{ question: "Do I need a computer?", answer: "We rent one." }]);
  });

  it("keeps a course out of the public list until it is published", async () => {
    const { db, shop } = await seededShopContext();
    const course = await createCourse(db, { shopId: shop.id, title: "Sidemount Diver" });
    if (!course) throw new Error("course not created");

    const isLive = async () =>
      (await listPublishedCourses(db, shop.id)).some((entry) => entry.id === course.id);

    expect(await isLive()).toBe(false);
    await setCoursePublished(db, shop.id, course.id, true);
    expect(await isLive()).toBe(true);

    // Publishing is not scheduling: hiding a course from the session picker
    // must not silently pull its page down, and vice versa.
    await setCourseVisibility(db, shop.id, course.id, false);
    expect(await isLive()).toBe(true);
  });

  it("finds a course by its public slug, scoped to the shop", async () => {
    const { db, shop } = await seededShopContext();
    // A title the seeded catalog does not already carry, so this exercises
    // slug minting rather than colliding with the shop's own course list.
    const course = await createCourse(db, { shopId: shop.id, title: "Cavern Diver" });
    expect((await getCourseBySlug(db, shop.id, "cavern-diver"))?.id).toBe(course?.id);
    expect(await getCourseBySlug(db, crypto.randomUUID(), "cavern-diver")).toBeNull();
  });

  it("cross-sells only published courses, in the order the shop chose", async () => {
    const { db, shop } = await seededShopContext();
    const sidemount = await createCourse(db, { shopId: shop.id, title: "Sidemount Diver" });
    const cavern = await createCourse(db, { shopId: shop.id, title: "Cavern Diver" });
    const draft = await createCourse(db, { shopId: shop.id, title: "Ice Diver" });
    if (!sidemount || !cavern || !draft) throw new Error("courses not created");
    await setCoursePublished(db, shop.id, sidemount.id, true);
    await setCoursePublished(db, shop.id, cavern.id, true);

    const related = await listRelatedCourses(db, shop.id, [cavern.id, sidemount.id, draft.id]);
    expect(related.map((entry) => entry.title)).toEqual(["Cavern Diver", "Sidemount Diver"]);
  });

  it("lists a course's bookable sessions and leaves past ones behind", async () => {
    const { db, shop, discover } = await courseContext();
    const courseId = discover.courseId;
    if (!courseId) throw new Error("discover session has no course");

    const sessions = await listUpcomingSessionsForCourse(db, shop.id, courseId);
    expect(sessions.map((session) => session.id)).toContain(discover.id);
    expect(sessions[0]).toHaveProperty("booked");

    const distantFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    expect(await listUpcomingSessionsForCourse(db, shop.id, courseId, distantFuture)).toEqual([]);
  });

  it("imports a Scuba template as an independent copy the shop can edit", async () => {
    const { db, shop } = await seededShopContext();
    const template = await publishTemplate(db, { slug: "sidemount-diver" });
    expect((await listGlobalCourseTemplates(db)).map((row) => row.template.slug)).toContain(
      "sidemount-diver",
    );

    const imported = await importGlobalCourseTemplate(db, shop.id, template.id);
    expect(imported).toMatchObject({
      title: "Sidemount Diver",
      slug: "sidemount-diver",
      summary: "Dive two cylinders at your sides",
      minimumCertificationLevel: "open_water",
      sourceTemplateVersion: 1,
      isPublished: false,
    });
    expect(imported?.includes).toEqual(["Two cylinders", "Sidemount harness"]);

    // The shop's edits are its own: a later template version must not reach
    // back into a live course, least of all its admission requirement.
    if (!imported) throw new Error("import failed");
    await updateCourseContent(db, shop.id, imported.id, {
      ...emptyContent,
      summary: "Our own words",
      relatedCourseIds: [],
    });
    await db.insert(globalCourseVersions).values({
      globalCourseId: template.id,
      version: 2,
      title: "Sidemount Diver",
      agency: "padi",
      minimumCertificationLevel: null,
      content: { ...emptyContent, summary: "Rewritten upstream" },
    });
    await db
      .update(globalCourses)
      .set({ currentVersion: 2 })
      .where(eq(globalCourses.id, template.id));

    const stored = await getCourseBySlug(db, shop.id, "sidemount-diver");
    expect(stored).toMatchObject({
      summary: "Our own words",
      minimumCertificationLevel: "open_water",
    });
  });

  it("returns the shop's existing course rather than duplicating it on re-import", async () => {
    const { db, shop } = await seededShopContext();
    // The shop already teaches Open Water; importing the template it came from
    // must be a no-op, not a second row with the shop's prices missing.
    const templates = await listGlobalCourseTemplates(db);
    const template = templates.find((row) => row.template.slug === "open-water-diver")?.template;
    if (!template) throw new Error("open-water template missing from the seed");
    const imported = await importGlobalCourseTemplate(db, shop.id, template.id);
    const seeded = await getCourseBySlug(db, shop.id, "open-water-diver");
    expect(imported?.id).toBe(seeded?.id);
    // The seeded course keeps its own pricing; the import did not overwrite it.
    expect(imported?.priceCents).toBe(49900);
    expect(
      (await db.select().from(courses).where(eq(courses.shopId, shop.id))).filter(
        (course) => course.title === "Open Water Diver",
      ),
    ).toHaveLength(1);
  });

  it("refuses to let template content relax the admission gate it ships beside", async () => {
    const { db, shop } = await seededShopContext();
    const template = await publishTemplate(db, { slug: "sidemount-diver" });
    // `content` is $type-asserted JSON, not validated: a published blob that
    // carries this key must not be able to overwrite the column.
    await db
      .update(globalCourseVersions)
      .set({
        content: {
          ...emptyContent,
          summary: "Smuggling a gate change through the content blob",
          minimumCertificationLevel: null,
        } as never,
      })
      .where(eq(globalCourseVersions.globalCourseId, template.id));

    const imported = await importGlobalCourseTemplate(db, shop.id, template.id);
    expect(imported?.minimumCertificationLevel).toBe("open_water");
  });

  it("suffixes a colliding slug so an import never trips the unique index", async () => {
    const { db, shop } = await seededShopContext();
    // Same slug, different title: the title check passes, the slug must not.
    await db
      .update(courses)
      .set({ slug: "sidemount-diver" })
      .where(eq(courses.slug, "scuba-refresher"));
    const template = await publishTemplate(db, { slug: "sidemount-diver" });
    const imported = await importGlobalCourseTemplate(db, shop.id, template.id);
    expect(imported?.slug).toBe("sidemount-diver-2");
  });
});
