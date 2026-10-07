"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "@/db/client";
import { countSetupRequestsSince, recordSetupRequest } from "@/db/funnel";
import { requestLocale } from "@/i18n/request";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { eventSource, SET_UP_SENT_PATH } from "@/lib/funnel";
import { log } from "@/lib/log";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import {
  parseSetupRequest,
  SETUP_FIELDS,
  SETUP_HONEYPOT_FIELD,
  SETUP_REQUESTS_PER_HOUR,
  type SetupField,
  type SetupRequestFormState,
  trippedHoneypot,
} from "@/lib/setup-requests";
// A plain module, deliberately not a second server action — see its comment.
import { announceSetupRequest } from "./announce";

/** Long enough for any honest answer; a value past it is refused by the parser anyway. */
const ECHO_MAX = 400;

/**
 * Store one set-up request and send the reader to the thank-you page (ADR
 * 20261007-setup-request-form). Public: no session, so every guard is here.
 *
 * In this order, each for a reason:
 * 1. **Per-IP rate limit** first, so a bot pays for every attempt, honeypot or
 *    not.
 * 2. **The honeypot**: a tripped one gets the thank-you page and nothing else
 *    — no row, no mail, no event, nothing the bot can tell apart from success.
 * 3. **Validation**, answered field by field with what the reader typed handed
 *    back, so a refusal never empties the form.
 * 4. **The global limit**, after the two checks that cost nothing, so junk
 *    cannot drain the bucket an honest request needs: the in-memory bucket as
 *    a first filter, then the real cap, counted in `setup_requests` over the
 *    last hour, because the bucket is per server instance.
 *
 * The mail and the event run in `after()`: the row is written before the
 * redirect, and nothing the reader is waiting on queues behind SES.
 */
export async function submitSetupRequestAction(
  _prev: SetupRequestFormState,
  formData: FormData,
): Promise<SetupRequestFormState> {
  const values = Object.fromEntries(
    SETUP_FIELDS.map((field) => {
      const value = formData.get(field);
      return [field, typeof value === "string" ? value.slice(0, ECHO_MAX) : ""];
    }),
  ) as Record<SetupField, string>;

  const ip = await clientIp();
  const byIp = await checkRateLimit(
    rateLimitKey("setup-request", ip),
    RATE_LIMITS.setupRequestByIp,
  );
  if (!byIp.allowed) return { formError: "rate_limited", values };

  if (trippedHoneypot(formData.get(SETUP_HONEYPOT_FIELD))) {
    // A count, so a bot wave shows in the drain; nothing it typed is logged.
    log("setup_request.honeypot_tripped", "info");
    redirect(SET_UP_SENT_PATH);
  }

  const parsed = parseSetupRequest(values);
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values };

  const everyone = await checkRateLimit(
    rateLimitKey("setup-request-global"),
    RATE_LIMITS.setupRequestGlobal,
  );
  if (!everyone.allowed) return { formError: "rate_limited", values };

  const db = await getDb();
  const hourAgo = new Date(nowDate().getTime() - HOUR_MS);
  if ((await countSetupRequestsSince(db, hourAgo)) >= SETUP_REQUESTS_PER_HOUR) {
    return { formError: "rate_limited", values };
  }

  const row = await recordSetupRequest(db, {
    ...parsed.data,
    source: eventSource(formData.get("source")),
    locale: await requestLocale(),
  });
  after(() => announceSetupRequest(row));

  redirect(SET_UP_SENT_PATH);
}
