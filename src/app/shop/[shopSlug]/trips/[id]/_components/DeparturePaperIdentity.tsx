import type { ReactNode } from "react";
import { formatDateWithYear, formatTimeTz } from "@/lib/format";

/** Detached sheets need a full calendar date, using the shop's zone and reader's locale. */
export function formatPaperDateTime(date: Date, locale: string, timeZone: string) {
  return `${formatDateWithYear(date, locale, timeZone)} · ${formatTimeTz(date, locale, timeZone)}`;
}

/** Escape CSS strings, including HTML-sensitive characters inside a style element. */
export function paperCssString(value: string): string {
  return `"${Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || /["\\<>]/.test(character) ? `\\${code.toString(16)} ` : character;
  }).join("")}"`;
}

/** User-entered line breaks never create unmeasured physical lines in a margin box. */
export function normalizePaperFact(value: string): string {
  return value.replace(/[\s\u0085\u200b\u2060]+/gu, " ").trim();
}

/** Chromium margin boxes do not reliably wrap unbroken names; supply real line breaks. */
export function paperFactLines(value: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const character of normalizePaperFact(value)) {
    // UTF-16 width is conservative for astral glyphs and never splits a surrogate pair.
    if (line.length + character.length > 60) {
      lines.push(line);
      line = "";
    }
    line += character;
  }
  if (line) lines.push(line);
  return lines;
}

/** Each named page carries only its own departure's identity, even in day packets. */
export function departurePaperRule(
  pageName: string,
  identity: string[],
  printed: string,
  standaloneLog = false,
): string {
  pageName = pageName.toLowerCase();
  if (!/^departure-[a-z0-9-]+$/.test(pageName)) throw new Error("Invalid departure page name");
  // Reserve space for wrapping rather than painting a fixed overlay over roster rows.
  // At 8pt a conservative 60 characters fit in the printable width of A4/Letter.
  const facts = identity.flatMap(paperFactLines);
  const lines = facts.length;
  const margin = 12 + lines * 4;
  // A standalone log owns the body too: returning to an unnamed page after its
  // last content otherwise makes Chromium append a page containing only a counter.
  const bodyRule = standaloneLog ? `body:has([data-departure-log]){page:${pageName}}` : "";
  return `@media print{[data-departure-paper="${pageName}"]{page:${pageName}}${bodyRule}}
@page ${pageName}{margin-top:${margin}mm;margin-bottom:20mm;
@top-left{content:${paperCssString(facts.join("\n"))};white-space:pre-wrap;overflow-wrap:anywhere;font:8pt/1.35 sans-serif;vertical-align:middle;width:100%}
@bottom-left{content:${paperCssString(normalizePaperFact(printed))};font:8pt/1.35 sans-serif;white-space:pre-wrap;width:80%}
@bottom-right{content:counter(page) " / " counter(pages);font:8pt monospace;width:20%}}
`;
}

export function DeparturePaperIdentity({
  pageName,
  identity,
  printed,
  children,
  standaloneLog = false,
}: {
  pageName: string;
  identity: string[];
  printed: string;
  children: ReactNode;
  standaloneLog?: boolean;
}) {
  return (
    <div data-departure-paper={pageName.toLowerCase()} className="contents print:block">
      <style>{departurePaperRule(pageName, identity, printed, standaloneLog)}</style>
      {children}
    </div>
  );
}
