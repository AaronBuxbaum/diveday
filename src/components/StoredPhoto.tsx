import Image from "next/image";

/**
 * A stored photo, rendered through `next/image` so a phone is served a
 * phone-sized file.
 *
 * Every photo URL the app holds is first-party: a root-relative bundled asset
 * (`/dive-sites/...`) or an object in our own blob store, which is the one
 * remote host `next.config.ts` allowlists in `images.remotePatterns`. Nothing
 * else can be written — a staff-pasted URL is fetched and re-stored at save
 * time by `ingestDiveSiteMedia`, which fails closed rather than persisting the
 * raw link (ADR 20260724-dive-site-media-ingestion), and course media only ever
 * arrives as a file upload. So there is no third-party-host case to branch on,
 * and `next/image` throwing on one would be the correct, loud response to a URL
 * that should not exist.
 *
 * `className` sizes the box (height/width/aspect/rounding/border); `object-cover`
 * is applied to the image itself.
 */
export function StoredPhoto({
  src,
  alt,
  className,
  sizes,
  priority = false,
}: {
  src: string;
  alt: string;
  className: string;
  /** Rendered widths, so the optimizer serves a phone a phone-sized photo. */
  sizes: string;
  /** The page's largest image above the fold — the storefront's cover — is fetched eagerly. */
  priority?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
    </div>
  );
}

/**
 * A stored photo that is **never drawn wider than its own pixels** (issue
 * #2419). `StoredPhoto` fills a box, so a 640px source in an 896px column is
 * scaled up and softens. This one takes no box: its dimensions are the file's,
 * capped by the column (`max-w-full`) and by `maxHeightClass`, and the optimizer
 * never enlarges a file, so a small photo sits at its own size, centred on a
 * sunken ground, and a large one fills the column as before. The width is not
 * stored anywhere, which is why the box cannot be sized from data.
 *
 * `maxHeightClass` is a Tailwind `max-h-*` (with any breakpoints) naming the
 * tallest the photo may stand.
 */
export function NaturalPhoto({
  src,
  alt,
  sizes,
  maxHeightClass,
  priority = false,
}: {
  src: string;
  alt: string;
  sizes: string;
  maxHeightClass: string;
  priority?: boolean;
}) {
  return (
    <div className="flex justify-center bg-surface-sunken">
      <Image
        src={src}
        alt={alt}
        width={0}
        height={0}
        sizes={sizes}
        priority={priority}
        className={`h-auto w-auto max-w-full object-cover ${maxHeightClass}`}
      />
    </div>
  );
}
