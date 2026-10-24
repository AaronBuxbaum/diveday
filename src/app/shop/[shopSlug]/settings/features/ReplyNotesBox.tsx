"use client";

import { type ComponentPropsWithoutRef, useEffect, useState } from "react";
import { textareaClassFor } from "@/components/ui/form";
import { REPLY_NOTES_MAX_LENGTH } from "@/lib/assists/inbox";

/**
 * The notes box itself. React's hydration of a server-drawn textarea can
 * reset a selection made a moment before, so a staffer's first keystrokes
 * (or a test's `fill`) land beside the old notes instead of replacing them
 * (#2973). It publishes the staff surfaces' `data-hydrated` flag, which the
 * e2e suite waits on before typing. The props `Field` clones in (its id and
 * description) pass straight through.
 */
export function ReplyNotesBox(props: ComponentPropsWithoutRef<"textarea">) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <textarea
      rows={4}
      maxLength={REPLY_NOTES_MAX_LENGTH}
      className={textareaClassFor(4)}
      {...props}
      data-hydrated={hydrated ? "true" : undefined}
    />
  );
}
