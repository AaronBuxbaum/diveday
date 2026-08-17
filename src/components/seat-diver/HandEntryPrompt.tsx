import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { buttonClass } from "@/components/ui/button";

/**
 * "Nobody on file by that name" — the shared empty box every seat-a-diver door
 * shows when a search found no returning diver, offering a direct link to add
 * the diver to the shop with their query prefilled.
 */
export function HandEntryPrompt({
  heading,
  body,
  actionLabel,
  href = "#hand-entry",
  className = "",
}: {
  heading: string;
  body: string;
  actionLabel: string;
  href?: string;
  className?: string;
}) {
  return (
    <EmptyState className={className}>
      <h3 className="font-medium">{heading}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>
      <Link
        href={href}
        className={buttonClass({ variant: "primary", size: "sm", className: "mt-4" })}
      >
        {actionLabel}
      </Link>
    </EmptyState>
  );
}
