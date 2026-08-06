import { EmptyState } from "@/components/EmptyState";
import { buttonClass } from "@/components/ui/button";

/**
 * "Nobody on file by that name" — the shared empty box every seat-a-diver door
 * shows when a search found no returning diver, with the sentence's "below"
 * made into a real door: the anchor scrolls to the `#hand-entry` form, which is
 * a scroll away on a counter phone and, on the Guests tab, force-opened for
 * exactly this case.
 */
export function HandEntryPrompt({
  heading,
  body,
  actionLabel,
  className = "",
}: {
  heading: string;
  body: string;
  actionLabel: string;
  className?: string;
}) {
  return (
    <EmptyState className={className}>
      <h3 className="font-medium">{heading}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>
      <a
        href="#hand-entry"
        className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
      >
        {actionLabel}
      </a>
    </EmptyState>
  );
}
