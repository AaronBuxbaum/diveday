"use client";

import { useEffect, useState } from "react";

import { SectionCard } from "@/components/ui/card";

/**
 * **The QR a shop prints for its counter** (issue #1236).
 *
 * The one thing standing between the register page existing and a shop
 * actually using it. Twelve of the 32 products surveyed on 2026-09-01 sell
 * this; what they are selling is a piece of card on a desk, so what this has to
 * produce is something a shop can point a phone at and something it can print.
 *
 * The URL is shown in full beside the code, because half the time the answer at
 * a busy desk is "just text me the link" — and because a QR nobody can read is
 * a QR nobody can check went to the right place.
 *
 * `qrcode` is imported dynamically for the same reason `EmbedGenerator` does
 * it: ~50 KB of encoder that a settings page which is mostly forms should not
 * carry until somebody is looking at this card.
 */
export function CounterQrCard({
  url,
  title,
  description,
}: {
  url: string;
  title: string;
  description: string;
}) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("qrcode").then(async (QRCode) => {
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240 });
      if (!cancelled) setQr(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <SectionCard title={title}>
      <p className="text-muted">{description}</p>
      <div className="mt-4 flex flex-wrap items-center gap-5">
        {/* Reserved at its final size whether or not the encoder has landed, so
            the card does not jump under a reader mid-print. */}
        <div className="size-[240px] shrink-0 rounded-lg bg-surface-sunken p-2">
          {qr ? (
            // biome-ignore lint/performance/noImgElement: a data: URL the client just produced.
            <img src={qr} alt={title} className="size-full" />
          ) : null}
        </div>
        <code className="text-sm break-all text-muted">{url}</code>
      </div>
    </SectionCard>
  );
}
