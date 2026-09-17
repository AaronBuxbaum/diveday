"use client";

import { useEffect, useState } from "react";

import { SettingsRow } from "./_components/SettingsRows";

/**
 * **The QR a shop prints for its counter** (issue #1236).
 *
 * The one thing standing between the register page existing and a shop
 * actually using it. Twelve of the 32 products surveyed on 2026-09-01 sell
 * this; what they are selling is a piece of card on a desk, so what this has to
 * produce is something a shop can point a phone at and something it can print.
 *
 * **It is a row, not a card.** This was a full bordered `SectionCard` — a
 * heading, a two-sentence caption, the URL, and a "Show the code" disclosure
 * inside it — standing between the "Data & integrations" group label and the
 * ten plain rows that are its siblings. One object in a list of eleven wearing
 * its own border is the inconsistency the group heading exists to prevent, and
 * the card's inner disclosure made it a disclosure inside a disclosure. It is
 * one `SettingsRow` now, in the directory's own grammar: the heading at rest,
 * and what the shop prints inside it.
 *
 * The URL is shown in full once the row is open, because half the time the
 * answer at a busy desk is "just text me the link" — and because a QR nobody
 * can read is a QR nobody can check went to the right place.
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
}: {
  url: string;
  title: string;
  description: string;
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
    <SettingsRow heading={title} description={description} onToggle={setOpen}>
      <code className="mt-3 block text-sm break-all text-muted">{url}</code>
      {/* Reserved at its final size whether or not the encoder has landed, so
          the row does not jump under a reader mid-print. */}
      <div className="mt-4 size-[240px] rounded-lg bg-surface-sunken p-2">
        {qr ? (
          // biome-ignore lint/performance/noImgElement: a data: URL the client just produced.
          <img src={qr} alt={title} className="size-full" />
        ) : null}
      </div>
    </SettingsRow>
  );
}
