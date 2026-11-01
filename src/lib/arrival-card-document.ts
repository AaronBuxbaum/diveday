/**
 * Inert HTML for the downloadable arrival card and offline readiness snapshot.
 * Text fields are escaped here; callers must escape user values in supplied HTML.
 */

import { escapeHtml } from "./html";

export { escapeHtml };

const STYLE =
  "body{font-family:system-ui,sans-serif;max-width:38rem;margin:0 auto;padding:2rem;line-height:1.5;color:currentColor}h1{line-height:1.15}p{margin:.45rem 0}.label{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.68}section{border-top:1px solid currentColor;margin-top:1.5rem;padding-top:1rem}a{color:inherit;font-weight:600}";

/** A complete document around `bodyHtml`, which the caller has already escaped. */
export function htmlDocument(input: { locale: string; title: string; bodyHtml: string }): string {
  return [
    "<!doctype html>",
    '<html lang="',
    escapeHtml(input.locale),
    '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>",
    escapeHtml(input.title),
    "</title><style>",
    STYLE,
    "</style></head><body>",
    input.bodyHtml,
    "</body></html>",
  ].join("");
}

function field(label: string, value: string | null | undefined): string {
  const clean = value?.trim();
  return clean
    ? '<section><p class="label">' +
        escapeHtml(label) +
        "</p><p>" +
        escapeHtml(clean) +
        "</p></section>"
    : "";
}

export type ArrivalCardContent = {
  locale: string;
  /** The `<title>`. */
  title: string;
  shopName: string;
  tripTitle: string;
  /** "Sat, Nov 1 · 7:30 AM – 11:00 AM", already formatted in the shop's zone. */
  when: string;
  dockCallLine: string | null;
  /** Paragraphs above the card's own content, in order. */
  notices?: readonly string[];
  fields: readonly { label: string; value: string | null | undefined }[];
  /** Raw HTML after the last field; the caller escapes it. */
  footerHtml?: string;
};

export function arrivalCardDocument(card: ArrivalCardContent): string {
  const notices = (card.notices ?? []).map((text) => `<p><strong>${escapeHtml(text)}</strong></p>`);
  return htmlDocument({
    locale: card.locale,
    title: card.title,
    bodyHtml: [
      ...notices,
      '<p class="label">',
      escapeHtml(card.shopName),
      "</p><h1>",
      escapeHtml(card.tripTitle),
      "</h1><p>",
      escapeHtml(card.when),
      "</p>",
      card.dockCallLine ? `<p><strong>${escapeHtml(card.dockCallLine)}</strong></p>` : "",
      ...card.fields.map((item) => field(item.label, item.value)),
      card.footerHtml ?? "",
    ].join(""),
  });
}
