import { z } from "zod";
import { nowDate } from "@/lib/clock";
import { periodBounds, type UsageSample } from "@/lib/cost-guardrails";
import {
  externalHttpBlocked,
  type Fetcher,
  httpFailureReason,
  MAX_RESPONSE_ROWS,
  type ProbeEnvironment,
  type ProbeOptions,
  probeRequest,
  unavailable,
} from "./probe";

/**
 * How much Vercel has charged this account so far this period.
 *
 * Reads `GET https://api.vercel.com/v1/billing/charges?teamId&from&to`, the
 * endpoint Vercel added for programmatic billing access. Two properties of it
 * shape everything below:
 *
 * 1. **The response is newline-delimited JSON, not a JSON document.** One row
 *    per charge line, streamed. So this parses line by line rather than calling
 *    `response.json()`.
 * 2. **Rows are FOCUS v1.3**, the FinOps open cost format, so the field names
 *    are the spec's (`BilledCost`, `EffectiveCost`, `ChargePeriodStart`) rather
 *    than Vercel's own.
 *
 * **Not verified against a live response.** Nothing in this repo has a Vercel
 * billing token, so the shape below is read off Vercel's published endpoint
 * documentation and the FOCUS specification, not off a recorded payload. The
 * parsing is therefore deliberately narrow and total: every field is optional
 * in the schema, an unrecognised row contributes nothing rather than throwing,
 * and a response that yields no usable row at all reports `unavailable` — not
 * a $0 reading. The first real run is the verification; the runbook says to
 * check the logged figure against the Vercel dashboard once, on purpose.
 */

/**
 * One FOCUS charge row, narrowed to the two fields this needs.
 *
 * `BilledCost` is what the invoice will say; `EffectiveCost` is the amortised
 * figure. Prefer billed, fall back to effective — a row carrying only the
 * latter still tells us more than skipping it. `passthrough` is deliberate: a
 * FOCUS row has dozens of columns and none of the others matter here.
 */
const focusChargeRowSchema = z
  .object({
    BilledCost: z.number().finite().optional(),
    EffectiveCost: z.number().finite().optional(),
  })
  .passthrough();

export type VercelSpendResult = {
  readonly sample: UsageSample;
  /** How many charge rows were summed. Logged so a zero reading is legible. */
  readonly rows: number;
};

function credentials(env: ProbeEnvironment): { token: string; teamId: string } | null {
  const token = env.USAGE_VERCEL_TOKEN?.trim();
  const teamId = env.USAGE_VERCEL_TEAM_ID?.trim();
  if (!token || !teamId) return null;
  return { token, teamId };
}

/**
 * Sum the account's billed cost over the current calendar month.
 *
 * Returns `not_configured` with no token, `unavailable` on any failure to
 * read, and `measured` only when at least one charge row parsed. The
 * distinction between the last two is the whole point — see `./probe.ts`.
 */
export async function fetchVercelSpend(options: ProbeOptions = {}): Promise<VercelSpendResult> {
  const env = options.env ?? process.env;
  const fetcher: Fetcher = options.fetcher ?? fetch;
  const now = options.now ?? nowDate();

  const configured = credentials(env);
  if (!configured) return { sample: { status: "not_configured" }, rows: 0 };
  if (externalHttpBlocked(env, fetcher)) {
    // Credentials exist but this process is forbidden from using them, so the
    // honest answer is "could not measure", not "nothing configured".
    return { sample: unavailable("external_http_disabled"), rows: 0 };
  }

  const { start, end } = periodBounds("calendar_month", now);
  const query = new URLSearchParams({
    teamId: configured.teamId,
    // Date-only, per the endpoint's ISO-8601 `from`/`to`. `end` is the
    // exclusive start of next month, so the last day of this one is included
    // without ever reaching into a period we are not asking about.
    from: start.toISOString().slice(0, 10),
    to: new Date(end.getTime() - 1).toISOString().slice(0, 10),
  });

  let response: Response;
  try {
    response = await fetcher(
      `https://api.vercel.com/v1/billing/charges?${query}`,
      probeRequest(configured.token),
    );
  } catch {
    return { sample: unavailable("network_error"), rows: 0 };
  }
  if (!response.ok) return { sample: unavailable(httpFailureReason(response.status)), rows: 0 };

  let body: string;
  try {
    body = await response.text();
  } catch {
    return { sample: unavailable("body_read_error"), rows: 0 };
  }

  const lines = body.split("\n");
  if (lines.length > MAX_RESPONSE_ROWS) {
    // A truncated sum would read as *lower* usage than reality, which is the
    // one direction a cost monitor must never round.
    return { sample: unavailable("response_too_large"), rows: lines.length };
  }

  let total = 0;
  let rows = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const row = focusChargeRowSchema.safeParse(parsed);
    if (!row.success) continue;
    const cost = row.data.BilledCost ?? row.data.EffectiveCost;
    if (cost === undefined) continue;
    total += cost;
    rows += 1;
  }

  // Zero rows means the shape was not what this expects — an empty body, an
  // error document with a 200, a schema change. A real account mid-month has
  // charge rows. Reporting $0 here would be the false all clear.
  if (rows === 0) return { sample: unavailable("no_charge_rows"), rows: 0 };

  // FOCUS costs can be negative (a credit). The period total should not be, but
  // if it is, `evaluateCeiling` downgrades it to `unavailable` rather than
  // treating it as very low usage — so clamping here would hide a real oddity.
  return { sample: { status: "measured", value: total }, rows };
}
