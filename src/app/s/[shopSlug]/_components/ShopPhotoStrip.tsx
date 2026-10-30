import { StoredPhoto } from "@/components/StoredPhoto";
import { sectionCardClass } from "@/components/ui/card";
import { ITEM_TITLE_CLASS, SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { Boat } from "@/db/boats";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * **The shop's own photos, under its cover** (`shops.shopfront_photo_urls`,
 * uploaded in Settings → Shop photos): the boats, the crew, the reef, in the
 * shop's order.
 *
 * A phone gets one row it swipes through, each photo most of the screen wide
 * so the next one shows at the edge and says there is more; the row is a
 * scroll region, so it takes focus and a name for a keyboard to reach it.
 * From `sm` the same photos are a grid, three across and four from `lg`.
 * Decorative (`alt=""`): the shop's name is the page's heading, and a photo
 * strip has no fact of its own for a screen reader to hear.
 *
 * Renders nothing when the shop has uploaded none, which is the default.
 */
export function ShopPhotoStrip({ urls, label }: { urls: readonly string[]; label: string }) {
  if (urls.length === 0) return null;
  return (
    <ul
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a horizontal scroll region must be reachable by keyboard
      tabIndex={0}
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 focus-visible:focus-ring-inset sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 print:hidden"
    >
      {urls.map((url) => (
        <li key={url} className="w-[78%] shrink-0 snap-start sm:w-auto">
          <StoredPhoto
            src={url}
            alt=""
            className="aspect-[4/3] w-full rounded-inset"
            sizes="(min-width: 1024px) 17rem, (min-width: 640px) 30vw, 72vw"
          />
        </li>
      ))}
    </ul>
  );
}

export function BoatsShelf({
  boats,
  t,
  className,
}: {
  boats: Boat[];
  t: DiverTranslator;
  className: string;
}) {
  if (boats.length === 0) return null;
  return (
    <section aria-labelledby="boats-heading" className={className}>
      <h2 id="boats-heading" className={`font-brand-display ${SECTION_TITLE_CLASS}`}>
        {t("schedule.boatsHeading")}
      </h2>
      <ul className="mt-4 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {boats.map((boat) => (
          <li
            key={boat.id}
            className={sectionCardClass({
              className:
                "flex min-h-14 flex-col gap-1 print:rounded-none print:border-x-0 print:border-b-0 print:px-0 print:py-2",
            })}
          >
            {boat.photoUrl ? (
              <StoredPhoto
                src={boat.photoUrl}
                alt={boat.name}
                className="mb-3 aspect-video w-full rounded-md print:hidden"
                sizes="(min-width: 1152px) 315px, (min-width: 1024px) calc(33.333vw - 66px), (min-width: 640px) calc(50vw - 72px), calc(100vw - 64px)"
              />
            ) : null}
            <div className="flex items-baseline justify-between gap-3">
              <span className={`font-brand-display ${ITEM_TITLE_CLASS} tracking-tight`}>
                {boat.name}
              </span>
              <span className="shrink-0 text-sm text-muted tabular-nums">
                {t("schedule.boatCapacity", { count: boat.capacity })}
              </span>
            </div>
            {boat.description ? (
              <p className="text-sm text-muted text-pretty">{boat.description}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
