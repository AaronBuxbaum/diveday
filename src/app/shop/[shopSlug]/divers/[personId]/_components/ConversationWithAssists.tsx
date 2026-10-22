import { after } from "next/server";
import type { ComponentProps } from "react";
import { languageName } from "@/components/assists/language-name";
import { assistsAvailable } from "@/db/assists";
import { getDb } from "@/db/client";
import { diverReplyLanguage, triageInboundMessagesSafely } from "@/db/inbox-assists";
import { requestFromMessageAction } from "../../../inbox/assist-actions";
import { draftReplyAction, translateReplyAction } from "../assist-actions";
import { ConversationSection } from "./ConversationSection";

/**
 * **The conversation, with Claude's assists when the shop has them on** (ADR
 * 20261018-claude-assists: `inbox-draft`, `translate`, `request`). Reads
 * whether the assists are on and which language the diver writes in, then
 * renders `ConversationSection` with or without them; a dark shop gets the
 * section exactly as it was. Messages nobody has read for intent and language
 * are read after the response, so the record never waits on Claude.
 */
export async function ConversationWithAssists(props: ComponentProps<typeof ConversationSection>) {
  const { entries, removed, shopSlug, personId, locale } = props;
  const first = entries[0];
  if (!first || removed) return <ConversationSection {...props} />;
  // The shop the page read the thread in: every entry is scoped to it.
  const shopId = first.direction === "inbound" ? first.message.shopId : first.reply.shopId;
  const db = await getDb();
  const [assists, replyLanguage] = await Promise.all([
    assistsAvailable(db, shopId),
    diverReplyLanguage(db, shopId, personId),
  ]);
  if (!assists) return <ConversationSection {...props} />;
  const unread = entries.flatMap((entry) =>
    entry.direction === "inbound" && entry.message.assistedAt === null ? [entry.message.id] : [],
  );
  if (unread.length > 0) after(() => triageInboundMessagesSafely(db, shopId, unread));
  return (
    <ConversationSection
      {...props}
      assist={{
        draft: draftReplyAction.bind(null, shopSlug, personId),
        translate: replyLanguage ? translateReplyAction.bind(null, shopSlug, personId) : null,
        diverLanguage: languageName(replyLanguage, locale),
        requestAction: requestFromMessageAction,
      }}
    />
  );
}
