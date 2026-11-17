import Image from "next/image";

/**
 * A stored photo, optimized for the device unless it is a private person
 * photo, which must reach its authenticated route directly.
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
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={src.startsWith("/api/person-photos/")}
        className="object-cover"
      />
    </div>
  );
}
