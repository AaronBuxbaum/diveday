import Image from "next/image";

/** The demo shop’s own cover, bundled and credited in public/dive-sites/README.md. */
export function MarketingStorefrontPhoto() {
  return (
    <Image
      src={`/dive-sites/${encodeURIComponent("Elkhorn coral 8 Molasses Reef 20080309.jpg")}`}
      alt=""
      width={1024}
      height={768}
      sizes="(max-width: 1023px) calc(100vw - 88px), 605px"
      className="mb-4 aspect-[16/7] w-full rounded-inset object-cover"
    />
  );
}
