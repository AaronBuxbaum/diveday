import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { SHOP_MAIN_CLASS } from "@/app/s/[shopSlug]/_components/shop-main";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { shopBySlugCached } from "@/features/platform/shops-cached";
import { getCourseBySlug } from "@/features/training/courses";
import { requestTranslator } from "@/i18n/request";
import { questionnaireForJurisdiction } from "@/lib/medical";
import { publicCoursePath, publicSchedulePath } from "@/lib/public-routes";

export const instant = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string; slug: string }>;
}): Promise<Metadata> {
  const { shopSlug } = await params;
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) return { title: "DiveDay" };
  const { t } = await requestTranslator(shop.defaultLocale);
  // A reference page under a course, not a listing of its own.
  return {
    title: `${t("course.medicalQuestions.title")} — ${shop.name}`,
    robots: { index: false },
  };
}

/**
 * **The medical questions, before the money** (issue #4329). A first-timer
 * with asthma used to meet them only inside the waiver, after booking, and
 * learn there that a doctor must sign a form first, four days out on holiday.
 * This is the same questionnaire the waiver asks (`questionnaireForJurisdiction`),
 * read-only: no field, no answer collected, nothing stored. Each question says
 * what a yes means: a yes to an asterisked question
 * means a doctor has to sign off before the diver boards (the boarding gate
 * holds a referral, so "should" undersold it), a yes to the others only opens
 * follow-ups (dive-domain review of #4329).
 * The questions stay English (H-20260730-jurisdiction-waiver-text-medical).
 */
export default async function CourseMedicalQuestionsPage({
  params,
}: {
  params: Promise<{ shopSlug: string; slug: string }>;
}) {
  await connection();
  const { shopSlug, slug } = await params;
  const db = await getDb();
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) notFound();
  if (!shop.coursesEnabled) redirect(publicSchedulePath(shopSlug));
  const course = await getCourseBySlug(db, shop.id, slug);
  if (!course?.isActive) notFound();
  const { t } = await requestTranslator(shop.defaultLocale);
  const questionnaire = questionnaireForJurisdiction(shop.jurisdiction);
  const questions = questionnaire.questions.filter((question) => question.section === "primary");
  const followUps = (parentId: string) =>
    questionnaire.questions.filter((question) => question.parentId === parentId);

  return (
    <main className={SHOP_MAIN_CLASS}>
      <div className="max-w-2xl">
        <ShopPageHeader
          eyebrow={t("course.medicalQuestions.back", { course: course.title })}
          returnTo={publicCoursePath(shop.slug, course.slug)}
          title={t("course.medicalQuestions.title")}
          description={t("course.medicalQuestions.lede", { shopName: shop.name })}
        />
        <ul className="divide-y divide-border border-y border-border">
          {questions.map((question) => (
            <li key={question.id} className="py-3">
              <p lang="en" className="font-medium text-pretty">
                {question.prompt}
              </p>
              <p className="mt-1 text-sm text-muted">
                {t(
                  question.referral
                    ? "course.medicalQuestions.yesNeedsDoctor"
                    : "course.medicalQuestions.yesOpensFollowUps",
                )}
              </p>
              {/* The Box a yes opens, closed until asked for: the asthma the
                  first-timer meant to mention is a follow-up of the lungs
                  question, and a doctor's sign-off hangs on it. */}
              {followUps(question.id).length > 0 ? (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer font-medium text-primary">
                    {t("course.medicalQuestions.followUps")}
                  </summary>
                  <p className="mt-2 text-muted">
                    {t("course.medicalQuestions.followUpsNeedDoctor")}
                  </p>
                  <ul className="mt-2 list-disc space-y-2 ps-5" lang="en">
                    {followUps(question.id).map((child) => (
                      <li key={child.id} className="text-pretty">
                        {child.prompt}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-muted">
          {t("course.medicalQuestions.askShop", { shopName: shop.name })}
        </p>
      </div>
    </main>
  );
}
