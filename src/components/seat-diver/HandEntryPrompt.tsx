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
  secondary,
  className = "",
}: {
  heading: string;
  body: string;
  actionLabel: string;
  href?: string;
  /** A quieter second door beside the first, for a surface with two honest ways in. */
  secondary?: { label: string; href: string };
  className?: string;
}) {
  return (
    <EmptyState
      titleAs="h3"
      title={heading}
      body={body}
      action={
        <div className="flex flex-wrap items-center gap-3">
          <Link href={href} className={buttonClass({ variant: "primary", size: "sm" })}>
            {actionLabel}
          </Link>
          {secondary ? (
            <Link href={secondary.href} className={buttonClass({ variant: "ghost", size: "sm" })}>
              {secondary.label}
            </Link>
          ) : null}
        </div>
      }
      className={className}
    />
  );
}
