"use server";

import { z } from "zod";
import { sendInterestReply } from "@/db/interest-replies";
import { setDateInterestOutcome } from "@/db/interests";
import { parseCharterQuote } from "@/lib/charter-quote";
import { nowDate } from "@/lib/clock";
import { parseForm, single } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

const outcomeForm = z.object({
  requestId: single(z.uuid()),
  // "open" is Reopen; a booking stamps `booked` from the seat itself, never here.
  outcome: single(z.enum(["done", "open"])),
});

/**
 * **Close a request, or reopen it** (third UX review, item 13). Every live
 * staff role reads the Requests page (issue #1679), so every one may tick a
 * lead it has answered. The id is scoped to the session's shop in the writer.
 */
export async function setRequestOutcomeAction(shopSlug: string, formData: FormData) {
  const { shop, db } = await requireShopSurface(shopSlug);
  const back = shopPath(shopSlug, "requests");
  const parsed = parseForm(outcomeForm, formData);
  if (parsed.ok) {
    await setDateInterestOutcome(db, {
      shopId: shop.id,
      interestId: parsed.data.requestId,
      outcome: parsed.data.outcome === "done" ? "done" : null,
      now: nowDate(),
    });
  }
  revalidateAndRedirect(back);
}

const replyForm = z.object({
  requestId: single(z.uuid()),
  // The words are checked by `sendInterestReply` (empty, too long), which
  // answers with a code; refusing here would say less.
  body: single(z.string()),
  // A private charter's whole-boat quote, in the shop's major unit; blank is none.
  quote: single(z.string()).optional(),
});

/**
 * The outcomes a reply lands back on the Requests page with. `sent` and
 * `closed` are the page's (the row has moved under Done, or was there
 * already); the rest name the row they belong to with `?request=`.
 */
export type RequestReplyNotice =
  | "reply-sent"
  | "reply-closed"
  | "reply-failed"
  | "reply-refused"
  | "reply-capped"
  | "reply-bad-quote"
  | "reply-send-limit";

/**
 * **Reply to a request from DiveDay** (issue #2555). Every live staff role
 * reads the Requests page and may answer a lead on it, as with Mark done. The
 * shop comes from the session's surface and the request id is scoped to it in
 * `sendInterestReply`, so an id from another shop is "not found"; the address
 * is the request's own and the form never names one.
 */
export async function replyToRequestAction(shopSlug: string, formData: FormData) {
  const { session, shop, db } = await requireShopSurface(shopSlug);
  const back = shopPath(shopSlug, "requests");
  const parsed = parseForm(replyForm, formData);
  if (!parsed.ok) revalidateAndRedirect(back, noticeUrl(back, "reply-refused"));
  // Bounded per staffer like every other one-tap send outside the shop.
  const sendAllowed = await checkRateLimit(
    rateLimitKey("staff-send", "interest-reply", session.user.personId),
    RATE_LIMITS.staffSendByActor,
  );
  if (!sendAllowed.allowed) {
    revalidateAndRedirect(
      back,
      noticeUrl(back, "reply-send-limit", { request: parsed.data.requestId }),
    );
  }
  const quote = parseCharterQuote(parsed.data.quote ?? "", shop.currency);
  if (!quote.ok) {
    revalidateAndRedirect(
      back,
      noticeUrl(back, "reply-bad-quote", { request: parsed.data.requestId }),
    );
  }
  const result = await sendInterestReply(db, {
    shopId: shop.id,
    interestId: parsed.data.requestId,
    body: parsed.data.body,
    quoteCents: quote.ok ? quote.cents : null,
    sentByPersonId: session.user.personId,
    now: nowDate(),
  });
  const notice: RequestReplyNotice =
    result.status === "sent"
      ? "reply-sent"
      : result.status === "failed"
        ? "reply-failed"
        : result.reason === "not_open"
          ? "reply-closed"
          : result.reason === "capped"
            ? "reply-capped"
            : result.reason === "bad_quote"
              ? "reply-bad-quote"
              : "reply-refused";
  const row = notice !== "reply-sent" && notice !== "reply-closed";
  revalidateAndRedirect(
    back,
    noticeUrl(back, notice, row ? { request: parsed.data.requestId } : undefined),
  );
}
