import type { DiverTranslator } from "@/i18n/messages";

/**
 * **The release, presented in full.** It reads as a document, not a widget:
 * no card, no box — a quiet titled rule above, the text set at reading size, a
 * closing rule below. The form after it is where the boxes are, so "read this"
 * and "do this" stop looking like the same component. Presenting the full text
 * is part of what typed consent means here: no disclosure, no clamp, no scroll
 * box (ADR 20260827-the-divers-thread).
 */
export function WaiverRelease({
  record,
  t,
}: {
  record: { templateTitle: string; templateVersion: number; templateBody: string };
  t: DiverTranslator;
}) {
  return (
    <section className="mt-8">
      <p className="border-b border-border pb-3 text-sm font-medium text-muted">
        {t("waiver.templateVersion", {
          title: record.templateTitle,
          version: record.templateVersion,
        })}
      </p>
      {/* `wrap-anywhere`, not just `whitespace-pre-wrap`. A shop's waiver text
          is pasted in, usually out of a PDF or a word processor, and real
          releases carry runs a line break can't fall inside: a signature rule
          of underscores, a policy URL, a long insurer name. `pre-wrap` alone
          only breaks at whitespace, so one of those lays the page out wider
          than the phone it is being signed on — measured at 455px against a
          390px viewport. `body { overflow-x: clip }` then stops the sideways
          scroll but not the widened layout viewport, which is what shows as
          empty space beside the page (2026-08-06 review). */}
      <div
        data-waiver-template-body
        className="mt-4 wrap-anywhere whitespace-pre-wrap border-b border-border pb-8 text-base leading-7"
      >
        {record.templateBody}
      </div>
    </section>
  );
}
