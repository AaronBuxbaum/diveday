"use client";

import Image from "next/image";
import { type ReactNode, useState } from "react";

interface MarketingScreenshotProps {
  src: string;
  alt: string;
  fallback: ReactNode;
  className?: string;
}

/**
 * Marketing images are generated from the real demo app by
 * scripts/capture-marketing-screenshots.mjs. The fallback keeps the public
 * pages useful in a fresh checkout before those generated assets are present.
 */
export function MarketingScreenshot({
  src,
  alt,
  fallback,
  className = "",
}: MarketingScreenshotProps) {
  const [unavailable, setUnavailable] = useState(false);

  if (unavailable) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`overflow-hidden rounded-2xl border border-border bg-surface text-left ${className}`}
      >
        {fallback}
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={1200}
      height={900}
      onError={() => setUnavailable(true)}
      className={`block h-auto w-full rounded-2xl border border-border bg-surface object-cover ${className}`}
    />
  );
}
