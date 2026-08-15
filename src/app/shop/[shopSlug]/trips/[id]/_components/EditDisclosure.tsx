import type { ReactNode } from "react";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";

/**
 * The Overview's summary-first shell for a section's form: the section states
 * its current value in quiet prose above, and the form waits behind this
 * disclosure. `open` must be true whenever the form has an outcome to show
 * (`noticeForForm` found one for this section) — a refusal that hides inside
 * a closed disclosure is a form the staffer cannot see failed.
 *
 * The summary carries no focusable descendants — an interactive element
 * nested in a `<summary>` fails axe's nested-interactive rule (see
 * RosterSection's disclosure, where this was found).
 */
export function EditDisclosure({
  label,
  open,
  children,
}: {
  label: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={open} className="group mt-2">
      <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 text-base font-semibold text-primary transition-colors [&::-webkit-details-marker]:hidden hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {label}
        <DisclosureCaret direction="down" className="size-4 group-open:rotate-180" />
      </summary>
      {children}
    </details>
  );
}
