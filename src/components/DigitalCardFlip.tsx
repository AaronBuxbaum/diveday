"use client";

import { useState } from "react";

export interface DigitalCardFlipCopy {
  diverLabel: string;
  cardNumberPrefix: (id: string) => string;
  statusVerified: string;
  statusRefresherDue: string;
  statusPending: string;
  noPhoto: string;
  certifiedByStaff: string;
  refresherDueVerify: string;
  awaitingVerification: string;
  idPrefix: (id: string) => string;
  secureLabel: string;
  openFullSize: string;
  tapToFlip: (target: string) => string;
  uploadedPhoto: string;
  securityDetails: string;
  flipAriaLabel: (level: string) => string;
  uploadedAlt: string;
}

export function DigitalCardFlip({
  fullName,
  agencyLabel,
  levelLabel,
  identifier,
  cardImageUrl,
  verificationStatus,
  copy,
}: {
  fullName: string;
  agencyLabel: string;
  levelLabel: string;
  identifier: string;
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
      <button
        type="button"
        className="relative block h-[200px] w-full max-w-[320px] cursor-pointer bg-transparent border-0 p-0 text-left"
        style={{ perspective: "1000px" }}
        onClick={() => setIsFlipped(!isFlipped)}
        aria-label={copy.flipAriaLabel(levelLabel)}
      >
        <div
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
            <div className="flex justify-between items-end border-t border-primary-foreground/20 pt-2 text-[10px] opacity-75">
              <span>{copy.cardNumberPrefix(identifier)}</span>
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
              // biome-ignore lint/performance/noImgElement: raw img tag is preferred for external dynamic uploads
              <img
                src={cardImageUrl}
                alt={copy.uploadedAlt}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center justify-between h-full w-full p-5 text-muted">
                <div className="w-full h-8 bg-foreground/15 rounded" />
                <div className="text-center py-4">
                  <p className="text-xs font-semibold">{copy.noPhoto}</p>
                  <p className="mt-1 text-[10px]">
                    {isCertified
                      ? copy.certifiedByStaff
                      : verificationStatus === "expired"
                        ? copy.refresherDueVerify
                        : copy.awaitingVerification}
                  </p>
                </div>
                <div className="w-full flex justify-between items-center text-[8px] opacity-50">
                  <span>{copy.idPrefix(identifier)}</span>
                  <span>{copy.secureLabel}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </button>
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
      <p className="mt-2 text-xs text-muted text-center">
        {copy.tapToFlip(cardImageUrl ? copy.uploadedPhoto : copy.securityDetails)}
      </p>
    </div>
  );
}
