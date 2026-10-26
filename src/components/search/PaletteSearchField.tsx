import type { KeyboardEventHandler, Ref } from "react";
import { buttonClass } from "@/components/ui/button";
import type { CommandPaletteCopy } from "./CommandPalette";

/** Search and explicit dismissal share the dialog's top row at every pointer width. */
export function PaletteSearchField({
  inputRef,
  pending,
  listId,
  activeId,
  copy,
  query,
  onQueryChange,
  onKeyDown,
  onClose,
}: {
  inputRef: Ref<HTMLInputElement>;
  pending: boolean;
  listId: string;
  activeId?: string;
  copy: Pick<CommandPaletteCopy, "comboboxAriaLabel" | "placeholder" | "close">;
  query: string;
  onQueryChange: (query: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center border-b border-border">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-busy={pending}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-label={copy.comboboxAriaLabel}
        autoComplete="off"
        placeholder={copy.placeholder}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        // Inset focus stays inside the clipped panel. The adjacent Close
        // control owns the other end of the header; options use active-descendant.
        className="min-w-0 flex-1 rounded-ss-panel bg-transparent px-5 py-4 text-base focus-visible:focus-ring-inset"
      />
      <button
        type="button"
        onClick={onClose}
        className={buttonClass({ variant: "ghost", className: "me-2 shrink-0" })}
      >
        {copy.close}
      </button>
    </div>
  );
}
