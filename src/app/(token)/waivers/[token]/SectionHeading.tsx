import { SECTION_TITLE_CLASS } from "@/components/ui/typography";

/**
 * What makes "do this" read differently from "read this": the release above the
 * form is an unboxed document with no heading at all, and each thing the diver
 * acts on — health check, emergency contact, signature — announces itself with
 * one. The published questionnaire title passes through unreworded.
 *
 * **These headings carry no numbers, and the page has exactly one scale of
 * progress.** They used to be numbered 1-2-3, which was fine while it was the
 * page's only enumeration; the step rail's arrival made it the second, and the
 * two disagreed — the rail counts Release · Medical · Sign (ADR
 * 20260827-the-divers-thread, decision 5) and the numbering counted the medical
 * form, the emergency contact and the signature. So a diver read "2 of 3 done"
 * at the top of the same viewport as "step 2 of 3" in the body, over two
 * different memberships, and the step the two quietly disagreed about — the
 * emergency contact — is the one worth not losing (glossary: a name *and* a
 * reachable number, "on file" only when both are there). The rail is the scale;
 * these are section headings, and the contact keeps its own.
 */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className={SECTION_TITLE_CLASS}>{children}</h2>;
}
