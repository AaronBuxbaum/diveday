"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { fill } from "@/i18n/fill";

export type LostItemRowCopy = {
  /** A template: `{name}` is the owner. */
  tell: string;
  /** A template: `{channel}` is how they were told. */
  told: string;
  channels: { email: string; sms: string; whatsapp: string };
  returned: string;
  discarded: string;
  reopen: string;
  unclaimed: string;
  statusReturned: string;
  statusDiscarded: string;
  refusals: Record<string, string> & { other: string };
};

export type LostItemRowState =
  | { status: "told"; channel: "email" | "sms" | "whatsapp" }
  | { status: "resolved" }
  | { status: "refused"; reason: string };

export type LostItemRowItem = {
  id: string;
  description: string;
  status: "open" | "returned" | "discarded";
  ownerName: string | null;
  toldChannel: "email" | "sms" | "whatsapp" | null;
};

/**
 * One found item and what can be done with it (batch 4, J2): tell the diver
 * whose seat it was found at, once; mark it returned or discarded; or put a
 * resolved item back on the open list. Shared by the Boat tab and the shop's
 * open list, each binding its own `action`.
 */
export function LostItemRow({
  item,
  context,
  action,
  copy,
}: {
  item: LostItemRowItem;
  /** A line under the description, e.g. which departure — the shop list's. */
  context?: string;
  action: (state: LostItemRowState | undefined, formData: FormData) => Promise<LostItemRowState>;
  copy: LostItemRowCopy;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const open = item.status === "open";
  const button = buttonClass({ variant: "secondary", size: "sm" });
  const facts = [
    context,
    item.ownerName ?? copy.unclaimed,
    item.toldChannel ? fill(copy.told, { channel: copy.channels[item.toldChannel] }) : null,
    item.status === "returned"
      ? copy.statusReturned
      : item.status === "discarded"
        ? copy.statusDiscarded
        : null,
  ].filter(Boolean);
  return (
    <li className="space-y-2 py-3" data-testid="lost-item">
      <div>
        <p className="font-medium">{item.description}</p>
        <p className="text-sm text-muted">{facts.join(" · ")}</p>
      </div>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="itemId" value={item.id} />
        {open && item.ownerName && !item.toldChannel ? (
          <button type="submit" name="intent" value="tell" className={button}>
            {fill(copy.tell, { name: item.ownerName })}
          </button>
        ) : null}
        {open ? (
          <>
            <button type="submit" name="intent" value="returned" className={button}>
              {copy.returned}
            </button>
            <button type="submit" name="intent" value="discarded" className={button}>
              {copy.discarded}
            </button>
          </>
        ) : (
          <button type="submit" name="intent" value="open" className={button}>
            {copy.reopen}
          </button>
        )}
        {state?.status === "refused" ? (
          <FormStatus>
            {Object.hasOwn(copy.refusals, state.reason)
              ? copy.refusals[state.reason]
              : copy.refusals.other}
          </FormStatus>
        ) : null}
      </form>
    </li>
  );
}
