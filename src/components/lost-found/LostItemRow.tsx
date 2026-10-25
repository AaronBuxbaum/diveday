"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
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
  paper = false,
}: {
  item: LostItemRowItem;
  /** A line under the description, e.g. which departure — the shop list's. */
  context?: string;
  action: (state: LostItemRowState | undefined, formData: FormData) => Promise<LostItemRowState>;
  copy: LostItemRowCopy;
  /** The trip packet's paper: the item and its facts, with no control. */
  paper?: boolean;
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
      {paper ? null : (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="itemId" value={item.id} />
          {open && item.ownerName && !item.toldChannel ? (
            <SubmitButton
              name="intent"
              value="tell"
              pendingLabel={fill(copy.tell, { name: item.ownerName })}
              className={button}
            >
              {fill(copy.tell, { name: item.ownerName })}
            </SubmitButton>
          ) : null}
          {open ? (
            <>
              <SubmitButton
                name="intent"
                value="returned"
                pendingLabel={copy.returned}
                className={button}
              >
                {copy.returned}
              </SubmitButton>
              <SubmitButton
                name="intent"
                value="discarded"
                pendingLabel={copy.discarded}
                className={button}
              >
                {copy.discarded}
              </SubmitButton>
            </>
          ) : (
            <SubmitButton name="intent" value="open" pendingLabel={copy.reopen} className={button}>
              {copy.reopen}
            </SubmitButton>
          )}
          {state?.status === "refused" ? (
            <FormStatus>
              {Object.hasOwn(copy.refusals, state.reason)
                ? copy.refusals[state.reason]
                : copy.refusals.other}
            </FormStatus>
          ) : null}
        </form>
      )}
    </li>
  );
}
