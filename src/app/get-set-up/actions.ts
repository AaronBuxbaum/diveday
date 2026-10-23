"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { countSetupRequestsSince, recordSetupRequest } from "@/db/funnel";
import { sendSetupRequestReceipt } from "@/features/setup-request-receipts";
import { requestLocale } from "@/i18n/request";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { formValue, parseForm } from "@/lib/form-parse";
import { eventSource, SET_UP_SENT_PATH } from "@/lib/funnel";
import { log } from "@/lib/log";
import { requestVisitorArm } from "@/lib/pricing-arm-request";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import {
  parseSetupRequest,
  SETUP_CURRENT_SYSTEMS,
  SETUP_FIELDS,
  SETUP_HONEYPOT_FIELD,
  SETUP_REQUESTS_PER_HOUR,
  type SetupCurrentSystem,
  type SetupField,
  type SetupRequestFormState,
  setupSentPath,
  trippedHoneypot,
} from "@/lib/setup-requests";
// A plain module, deliberately not a second server action — see its comment.
import { announceSetupRequest } from "./announce";

/** Long enough for any honest answer; a value past it is refused by the parser anyway. */
const ECHO_MAX = 400;

/**
 * The form as `FormData.get` reads it, field by field: what the reader typed
 * (narrowed and validated by `parseSetupRequest`), the honeypot and where the
 * reader came from.
 */
const setupForm = z.object({
  ...(Object.fromEntries(SETUP_FIELDS.map((field) => [field, formValue()])) as Record<
    SetupField,
    ReturnType<typeof formValue>
  >),
  [SETUP_HONEYPOT_FIELD]: formValue(),
  source: formValue(),
});

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
  const form = parseForm(setupForm, formData);
  // Every field of the schema takes any value, so the read cannot refuse.
  if (!form.ok) throw new Error("the set-up form's schema refused a form");
  const values = Object.fromEntries(
    SETUP_FIELDS.map((field) => {
      const value = form.data[field];
      return [field, typeof value === "string" ? value.slice(0, ECHO_MAX) : ""];
    }),
  ) as Record<SetupField, string>;

  const ip = await clientIp();
  const byIp = await checkRateLimit(
    rateLimitKey("setup-request", ip),
    RATE_LIMITS.setupRequestByIp,
  );
  if (!byIp.allowed) return { formError: "rate_limited", values };

  if (trippedHoneypot(form.data[SETUP_HONEYPOT_FIELD])) {
    // A count, so a bot wave shows in the drain; nothing it typed is logged.
    log("setup_request.honeypot_tripped", "info");
    // The same address a person with that answer gets, so the page tells the
    // bot nothing about whether it was caught.
    const answered = (SETUP_CURRENT_SYSTEMS as readonly string[]).includes(values.currentSystem);
    redirect(
      answered
        ? setupSentPath(
            SET_UP_SENT_PATH,
            values.currentSystem as SetupCurrentSystem,
            values.currentSystemGuide,
          )
        : SET_UP_SENT_PATH,
    );
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
    source: eventSource(form.data.source),
    locale: await requestLocale(),
    receiptPending: true,
    // The pricing arm this reader was shown (ADR 20261022-pricing-ab-test),
    // so the shop the request becomes is put on it. Null while the test is off.
    pricingPlan: await requestVisitorArm(),
  });
  after(() => announceSetupRequest(row));
  after(() => sendSetupRequestReceipt(row.id));

  // What they use today, and which system, and nothing else, ride to the next
  // page (item 55; the system since 2026-10-22).
  redirect(
    setupSentPath(SET_UP_SENT_PATH, parsed.data.currentSystem, parsed.data.currentSystemGuide),
  );
}
