import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { StarRating } from "@/components/StarRating";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getShopReviewAggregate, listShopReviewsForStaff } from "@/db/reviews";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { formatShortDate } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { setReviewPublishedAction } from "./actions";

export const metadata: Metadata = {
  title: "Reviews — DiveDay",
};

const NOTICES: Record<string, { tone: "success" | "danger"; text: string }> = {
  published: { tone: "success", text: "Review published to your schedule page." },
  hidden: { tone: "success", text: "Review hidden — it no longer counts toward your rating." },
  error: { tone: "danger", text: "That review couldn't be updated. Try again." },
};

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  const [reviews, aggregate] = await Promise.all([
    listShopReviewsForStaff(db, session.user.shopId),
    getShopReviewAggregate(db, session.user.shopId),
  ]);
  const waiting = reviews.filter((review) => !review.isPublished);
  const banner = notice ? NOTICES[notice] : undefined;
  const locale = await requestLocale(shop?.defaultLocale);
  const timezone = shop?.timezone ?? "UTC";

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow="Reviews"
        title="What divers said"
        description="Every review here was left through a diver's own post-trip recap link, so all of them came from someone who was on the boat. A rating on its own publishes straight away; anything with words waits for you."
        actions={
          <Link
            href={`/shop/${shopSlug}/schedule`}
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            View public page
          </Link>
        }
      />

      {banner ? (
        <div className="mb-6">
          <ShopNotice tone={banner.tone} role={banner.tone === "danger" ? "alert" : "status"}>
            {banner.text}
          </ShopNotice>
        </div>
      ) : null}

      <section aria-label="Rating overview" className="mb-8 grid gap-3 sm:grid-cols-3">
        <ShopStat
          label="Public rating"
          value={aggregate.average === null ? "—" : aggregate.average.toFixed(1)}
          detail={
            aggregate.count === 0
              ? "Nothing published yet"
              : `Across ${aggregate.count} published ${aggregate.count === 1 ? "review" : "reviews"}`
          }
          tone="primary"
        />
        <ShopStat label="Published" value={aggregate.count} detail="Shown on your schedule page" />
        <ShopStat
          label="Waiting on you"
          value={waiting.length}
          detail="Reviews with words to read"
          tone={waiting.length > 0 ? "primary" : undefined}
        />
      </section>

      {reviews.length === 0 ? (
        <EmptyState>
          <h2 className="font-medium">No reviews yet</h2>
          <p className="mt-1 text-sm text-muted">
            Divers are asked for one on their recap page after a trip sails. The first ones will
            land here.
          </p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:items-start"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <StarRating rating={review.rating} />
                  <Badge tone={review.isPublished ? "success" : "neutral"}>
                    {review.isPublished ? "Published" : "Waiting on you"}
                  </Badge>
                </div>
                {review.comment ? (
                  <p className="mt-2 text-base text-pretty">{review.comment}</p>
                ) : (
                  <p className="mt-2 text-sm text-muted italic">
                    Rating only — no words to review.
                  </p>
                )}
                <p className="mt-2 text-sm text-muted">
                  {review.diverName} ·{" "}
                  <Link
                    href={`/shop/${shopSlug}/trips/${review.tripId}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {review.tripTitle}
                  </Link>{" "}
                  · {formatShortDate(review.divedAt, locale, timezone)}
                </p>
              </div>
              <form action={setReviewPublishedAction} className="shrink-0">
                <input type="hidden" name="reviewId" value={review.id} />
                <input type="hidden" name="publish" value={String(!review.isPublished)} />
                <SubmitButton
                  pendingLabel="Saving…"
                  className={buttonClass(
                    review.isPublished
                      ? { variant: "secondary", className: "text-foreground" }
                      : {},
                  )}
                >
                  {review.isPublished ? "Hide" : "Publish"}
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
