import Link from "next/link";
import { tapTargetLinkClass } from "@/components/ui/button";
import type { WhatsNextRow as WhatsNextRowProps } from "@/features/after-the-dive/recap-after-state";

/**
 * **One quiet row under *Your next dive*** (issue #4328): the next course on
 * the shop's ladder, or its dive package for a repeat diver. One row, never a
 * carousel, and nothing when the shop sells neither (`buildAfterStateProps`
 * decides which, and worded both lines).
 */
export function WhatsNextRow({ row }: { row: WhatsNextRowProps | null }) {
  if (!row) return null;
  return (
    <div className="mt-6 flex flex-col gap-1 border-y border-border py-4">
      <Link
        href={row.href}
        className={`${tapTargetLinkClass} -my-2 self-start py-2 text-base font-medium text-primary hover:underline`}
      >
        {row.title}
      </Link>
      <span className="text-sm text-muted">{row.detail}</span>
    </div>
  );
}
