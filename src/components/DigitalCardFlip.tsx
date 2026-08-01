"use client";

import Image from "next/image";
import { useState } from "react";
import { isManagedBlobUrl } from "@/lib/storage/blob-host";

/**
 * Every value here is a plain, already-composed string — never a function.
 * This crosses from a Server Component into this Client Component, and React
 * rejects a function prop at that boundary ("Functions cannot be passed
 * directly to Client Components"). The caller interpolates card number,
 * level, and photo-target into the ICU message server-side (so word order
 * stays correct per locale) and hands down the finished sentence.
 */
export interface DigitalCardFlipCopy {
  diverLabel: string;
  cardNumberText: string;
  statusVerified: string;
  statusRefresherDue: string;
  statusPending: string;
  noPhoto: string;
  certifiedByStaff: string;
  refresherDueVerify: string;
  awaitingVerification: string;
  idText: string;
  secureLabel: string;
  openFullSize: string;
  tapToFlipText: string;
  flipAriaLabel: string;
  uploadedAlt: string;
}

export function DigitalCardFlip({
  fullName,
  agencyLabel,
  levelLabel,
  cardImageUrl,
  verificationStatus,
  copy,
}: {
  fullName: string;
  agencyLabel: string;
  levelLabel: string;
  cardImageUrl: string | null;
  verificationStatus: "pending" | "verified" | "expired";
  copy: DigitalCardFlipCopy;
}) {
  const [isFlipped, setIsFlipped] = useState(false);
  const isCertified = verificationStatus === "verified";
  const statusLabel = isCertified
    ? copy.statusVerified
    : verificationStatus === "expired"
      ? copy.statusRefresherDue
      : copy.statusPending;

  return (
    <div className="mt-3 flex flex-col items-center">
      {/*
       * The whole card used to be a `<button aria-label={copy.flipAriaLabel}>` —
       * an explicit `aria-label` replaces a control's entire accessible name,
       * so a screen reader announced only "Flip card" here, never the agency,
       * level, diver name, or verification status underneath (and the front
       * face's `<h4>` was nested inside that button, which is invalid). The
       * card is now a plain, fully-readable `<div>`; the flip affordance is
       * its own small labeled control layered on top.
       */}
      <div className="relative w-full max-w-[320px]">
        <div className="relative h-[200px] w-full" style={{ perspective: "1000px" }}>
          <div
            data-testid="digital-card-inner"
            className="relative h-full w-full transition-transform duration-500"
            style={{
              transformStyle: "preserve-3d",
              transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
            }}
          >
            {/* Front Side */}
            <div
              className="absolute inset-0 flex flex-col justify-between rounded-xl bg-gradient-to-br from-primary/90 to-primary-sunken p-5 text-primary-foreground shadow-lg border border-primary/20"
              style={{ backfaceVisibility: "hidden" }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider opacity-85">
                    {agencyLabel}
                  </p>
                  <h4 className="mt-1 text-lg font-bold tracking-tight">{levelLabel}</h4>
                </div>
                <span className="text-xl">🌊</span>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider opacity-70">{copy.diverLabel}</p>
                <p className="font-semibold text-base">{fullName}</p>
              </div>
              <div className="flex justify-between items-end border-t border-primary-foreground/20 pt-2 text-xs opacity-75">
                <span>{copy.cardNumberText}</span>
                <span className="font-semibold">{statusLabel}</span>
              </div>
            </div>

            {/* Back Side */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-surface-sunken shadow-lg border border-border overflow-hidden"
              style={{
                backfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
            >
              {cardImageUrl ? (
                // Card photos are uploaded through storeCardImage (blob storage) today, but
                // this column has always been a provider-neutral URL (src/db/schema.ts), so
                // an unrecognized host still renders — just without next/image's optimization.
                <Image
                  src={cardImageUrl}
                  alt={copy.uploadedAlt}
                  fill
                  sizes="320px"
                  unoptimized={!isManagedBlobUrl(cardImageUrl)}
                  className="object-contain"
                />
              ) : (
                <div className="flex flex-col items-center justify-between h-full w-full p-5 text-muted">
                  <div className="w-full h-8 bg-foreground/15 rounded" />
                  <div className="text-center py-4">
                    <p className="text-xs font-semibold">{copy.noPhoto}</p>
                    <p className="mt-1 text-xs">
                      {isCertified
                        ? copy.certifiedByStaff
                        : verificationStatus === "expired"
                          ? copy.refresherDueVerify
                          : copy.awaitingVerification}
                    </p>
                  </div>
                  <div className="w-full flex justify-between items-center text-xs opacity-50">
                    <span>{copy.idText}</span>
                    <span>{copy.secureLabel}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsFlipped((flipped) => !flipped)}
          aria-label={copy.flipAriaLabel}
          className="absolute right-2 bottom-2 inline-flex size-9 items-center justify-center rounded-full border border-border bg-surface/90 text-foreground shadow-sm transition-colors hover:bg-surface-sunken"
        >
          <span aria-hidden="true" className="text-base">
            ⟳
          </span>
        </button>
      </div>
      {cardImageUrl ? (
        <a
          href={cardImageUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 text-xs font-semibold text-primary underline underline-offset-2"
        >
          {copy.openFullSize}
        </a>
      ) : null}
      <p className="mt-2 text-xs text-muted text-center">{copy.tapToFlipText}</p>
    </div>
  );
}
