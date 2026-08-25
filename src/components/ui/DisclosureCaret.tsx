import { type DisclosureCaretDirection, DiveDayIcon } from "@/components/StaffDestinationIcon";

export type { DisclosureCaretDirection };

/** The shared drawn chevron for disclosure triggers. */
export function DisclosureCaret({
  direction = "right",
  className = "",
}: {
  direction?: DisclosureCaretDirection;
  className?: string;
}) {
  return (
    <DiveDayIcon
      name="caret"
      direction={direction}
      className={`size-3 shrink-0 transition-transform ${className}`}
    />
  );
}
