"use client";

import { useEffect, useState } from "react";

import { SectionCard } from "@/components/ui/card";
import { CompactDisclosureRow } from "@/components/ui/disclosure";

/**
 * **The QR a shop prints for its counter** (issue #1236).
 *
 * The one thing standing between the register page existing and a shop
 * actually using it. Twelve of the 32 products surveyed on 2026-09-01 sell
 * this; what they are selling is a piece of card on a desk, so what this has to
 * produce is something a shop can point a phone at and something it can print.
 *
 * The URL is shown in full at rest, because half the time the answer at a busy
 * desk is "just text me the link" — and because a QR nobody can read is a QR
 * nobody can check went to the right place.
 *
 * **The code itself is folded away.** Printing the card is a thing a shop does
 * once, and a 240px block of noise sat permanently open in the middle of a
 * settings page every staffer scrolls past for the rows either side of it. It
 * is one row now, in the same disclosure grammar as the rest of the page.
 *
 * Folding it also makes `qrcode` genuinely lazy: it was imported dynamically
 * for the reason `EmbedGenerator` does it — ~50 KB of encoder a settings page
 * that is mostly forms should not carry — but a mounted card fetched it on
 * every visit anyway. The effect is keyed on the disclosure now, so the bytes
 * land when somebody asks for the code and not before.
 */
export function CounterQrCard({
  url,
  title,
  description,
  showLabel,
}: {
  url: string;
  title: string;
  description: string;
  /** The disclosure's own row — "Show the code". */
  showLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    import("qrcode").then(async (QRCode) => {
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240 });
      if (!cancelled) setQr(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  return (
    <SectionCard title={title}>
      <p className="text-muted">{description}</p>
      <code className="mt-4 block text-sm break-all text-muted">{url}</code>
      <CompactDisclosureRow id="counter-qr" label={showLabel} className="mt-4" onToggle={setOpen}>
        {/* Reserved at its final size whether or not the encoder has landed, so
            the card does not jump under a reader mid-print. */}
        <div className="size-[240px] rounded-lg bg-surface-sunken p-2">
          {qr ? (
            // biome-ignore lint/performance/noImgElement: a data: URL the client just produced.
            <img src={qr} alt={title} className="size-full" />
          ) : null}
        </div>
      </CompactDisclosureRow>
    </SectionCard>
  );
}
