import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS, SHELL_TITLE_CLASS } from "@/components/ui/typography";

/**
 * Tag-shaped skeleton (design principle 1): the page's own wrapping header
 * row, so the rule under it does not jump when the tag arrives — the name
 * block beside the 48px Print button on a desk, under it on a phone — then the
 * pieces list frame and the heading above it.
 */
export default function ClaimTagLoading() {
  return (
    <div className="animate-pulse">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div className="w-md max-w-full">
          <div className="h-4 w-20 rounded bg-surface-sunken" />
          <div
            className={`mt-1 h-lh ${SHELL_TITLE_CLASS} w-56 max-w-full rounded bg-surface-sunken`}
          />
          <div className="mt-1 h-6 w-44 max-w-full rounded bg-surface-sunken" />
        </div>
        <div className="h-12 w-40 rounded-lg bg-surface-sunken" />
      </div>
      <div className={`mt-8 h-lh ${SECTION_TITLE_CLASS} w-40 rounded bg-surface-sunken`} />
      <div className={sectionCardClass({ padding: "none", className: "mt-3 h-28 w-full" })} />
      <div className={`mt-8 h-lh ${SECTION_TITLE_CLASS} w-44 rounded bg-surface-sunken`} />
      <div className="mt-3 h-6 w-full max-w-md rounded bg-surface-sunken" />
    </div>
  );
}
