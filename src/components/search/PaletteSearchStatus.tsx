import { buttonClass } from "@/components/ui/button";
import type { CommandPaletteCopy, PaletteGroup } from "./CommandPalette";
import type { SearchStatus } from "./palette-hooks";

/** Request state and result counts share the palette's one live announcement. */
export function paletteSearchPresentation({
  status,
  query,
  groups,
  copy,
}: {
  status: SearchStatus;
  query: string;
  groups: PaletteGroup[];
  copy: CommandPaletteCopy;
}) {
  const searchMessage =
    status === "pending"
      ? copy.searching
      : status === "error"
        ? copy.searchFailed
        : status === "unauthorized"
          ? copy.searchUnauthorized
          : status === "success" && groups.every((group) => group.id === "add-diver")
            ? copy.emptyNoMatches
            : undefined;
  const currentGroups = groups
    .map((group) =>
      group.heading ? `${group.heading} (${group.items.length})` : group.items[0]?.label,
    )
    .filter(Boolean)
    .join(", ");
  // Local commands remain actionable during lookup, so announce them with its state.
  const resultsAnnouncement =
    query.trim().length < 2 && !searchMessage
      ? copy.emptyShort
      : [searchMessage, currentGroups].filter(Boolean).join(", ");

  return { searchMessage, resultsAnnouncement };
}

/** Recovery controls sit outside the result list so they remain ordinary focus stops. */
export function PaletteSearchStatus({
  message,
  status,
  retry,
  copy,
}: {
  message: string | undefined;
  status: SearchStatus;
  retry: () => void;
  copy: Pick<CommandPaletteCopy, "retry" | "signInAgain">;
}) {
  if (!message) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
      <p className="text-sm text-muted">{message}</p>
      {status === "error" ? (
        <button
          type="button"
          onClick={retry}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.retry}
        </button>
      ) : status === "unauthorized" ? (
        <a href="/sign-in" className={buttonClass({ variant: "secondary", size: "sm" })}>
          {copy.signInAgain}
        </a>
      ) : null}
    </div>
  );
}
