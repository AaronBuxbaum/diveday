import { StoredPhoto } from "@/components/StoredPhoto";

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
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 focus-visible:focus-ring sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4"
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
