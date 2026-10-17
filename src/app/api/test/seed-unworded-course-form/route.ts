import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  createCourseForm,
  listCourseFormRequirements,
  setCourseFormRequirements,
} from "@/db/course-forms";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { courses } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listStaff } from "@/db/trips";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Gives the demo's Open Water Diver course **a form with a title and no
 * words yet**, so the Courses roster's agency-wording notice has something to
 * say (UX review 2026-10-10, item 16).
 *
 * The seed words every form the demo requires (fourth review, item 53), so a
 * running shop opens Courses without the notice. This is the moment a shop
 * meets it: it has named the agency's form and not yet written it. Through
 * `createCourseForm` and `setCourseFormRequirements`, the course editor's own
 * doors, appended to the forms the course already requires.
 *
 * Mutating the shared fixture is safe: each Playwright worker owns its database
 * and `/api/test/reset` restores the seed before every test. Gated identically
 * to `/api/test/reset`, so it can never be reachable in a real deployment.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_demo" }, { status: 404 });

  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")))
    .limit(1);
  if (!course) return NextResponse.json({ error: "no_course" }, { status: 404 });
  const [staff] = await listStaff(db, shop.id);
  if (!staff) return NextResponse.json({ error: "no_staff" }, { status: 404 });

  const form = await createCourseForm(db, {
    shopId: shop.id,
    title: "Youth Diving: Responsibility and Risks Acknowledgment",
    body: "",
    actorPersonId: staff.person.id,
  });
  const current = await listCourseFormRequirements(db, shop.id, course.id);
  const saved = await setCourseFormRequirements(db, {
    shopId: shop.id,
    courseId: course.id,
    formIds: [...current, form.id],
    // Adding a form asks more students, which any writer may.
    mayNarrow: false,
  });
  if (!saved.ok) return NextResponse.json({ error: saved.reason }, { status: 409 });

  return NextResponse.json({ ok: true });
}
