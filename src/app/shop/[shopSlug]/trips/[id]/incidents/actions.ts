"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import {
  addIncidentAddendum,
  addIncidentPerson,
  discardIncidentDraft,
  fileIncidentReport,
  type IncidentSubject,
  type IncidentWriteRefusal,
  type MissingSubject,
  removeIncidentPerson,
  saveIncidentDraft,
  setIncidentLegalHold,
  startIncidentReport,
  startMissingDiverReport,
} from "@/db/incident-reports";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  type IncidentFieldRefusal,
  isIncidentInvolvement,
  parseIncidentDraft,
} from "@/lib/incident-reports";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";
import { manifestCheckpointParam } from "./[reportId]/_components/manifest-return";

/**
 * The incident report's writes (ADR 20261012-incident-reports). Each reads the
 * session's shop, never the URL's, and the database decides who may write:
 * a refusal for a report the actor may not read is `not_found`, the same as a
 * report that does not exist.
 */

function reportPath(shopSlug: string, tripId: string, reportId: string): string {
  return shopPath(shopSlug, "trips", tripId, "incidents", reportId);
}

/** Every write refusal's code, as the report page's notice map spells it. */
const REFUSAL_NOTICE: Record<
  Exclude<IncidentWriteRefusal, "not_found" | "not_allowed" | "too_long">,
  string
> = {
  filed: "already-filed",
  draft: "not-yet-filed",
  incomplete: "incomplete",
  site_not_found: "site-not-found",
  subject_not_found: "subject-not-found",
  already_listed: "already-listed",
  blank: "blank-note",
  held: "held",
};

const FIELD_NOTICE: Record<IncidentFieldRefusal, string> = {
  occurred_at_invalid: "occurred-at-invalid",
  handed_over_at_invalid: "handed-over-at-invalid",
  handed_over_before_incident: "handed-over-before-incident",
  oxygen_minutes_invalid: "oxygen-minutes-invalid",
  text_too_long: "text-too-long",
};

/** Back to the report with a notice, or to a 404 for a report this actor cannot see. */
function settle(
  back: string,
  result: { ok: true } | { ok: false; reason: IncidentWriteRefusal },
  done: string,
  form: string,
): never {
  if (result.ok) revalidateAndRedirect(back, noticeUrl(back, done, { form }));
  if (result.reason === "not_found" || result.reason === "not_allowed") notFound();
  const notice =
    result.reason === "too_long"
      ? form === "addenda"
        ? "note-too-long"
        : "name-too-long"
      : REFUSAL_NOTICE[result.reason];
  revalidateAndRedirect(back, noticeUrl(back, notice, { form }));
}

/** A bound id arrives from the browser: one that is not a uuid names nothing. */
function requireIds(...ids: string[]): void {
  if (!ids.every((id) => uuidParam(id))) notFound();
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Start a draft on a departure and open it. */
export async function startIncidentReportAction(shopSlug: string, tripId: string) {
  const { session, shop } = await requireShopSurface(shopSlug);
  const tripPage = `${shopPath(shopSlug, "trips", tripId)}?view=details`;
  if (!uuidParam(tripId)) redirect(noticeUrl(tripPage, "not-authorized"));
  const result = await startIncidentReport(await getDb(), {
    shopId: shop.id,
    tripId,
    actorPersonId: session.user.personId,
  });
  if (!result.ok) redirect(noticeUrl(tripPage, "not-authorized"));
  revalidateAndRedirect(
    shopPath(shopSlug, "trips", tripId),
    reportPath(shopSlug, tripId, result.reportId),
  );
}

/** What "Start a missing diver report" answers in place when it opens nothing. */
export type MissingReportState = { message: string } | null;

/**
 * **"Start a missing diver report"** on a manifest row marked not back aboard,
 * a diver's (`bookingId`) or a crew member's (`personId`): the one report for
 * that missing person (`startMissingDiverReport`), opened with the way back
 * to the manifest it came from.
 *
 * Under `useActionState`, so every way it can fail is a sentence beside the
 * button (domain review 2026-10-16): a thrown write used to swap the whole
 * manifest for the error page, in the minutes the crew most needs it. Only
 * the success navigates.
 */
export async function startMissingDiverReportAction(
  shopSlug: string,
  tripId: string,
  _previous: MissingReportState,
  formData: FormData,
): Promise<MissingReportState> {
  const { session, shop } = await requireShopSurface(shopSlug);
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  const bookingId = text(formData, "bookingId");
  const personId = text(formData, "personId");
  const subject: MissingSubject | null = uuidParam(bookingId)
    ? { kind: "diver", bookingId }
    : uuidParam(personId)
      ? { kind: "crew", personId }
      : null;
  if (!uuidParam(tripId) || !subject) return { message: t("incidents.missingDiver.notMissing") };
  let result: Awaited<ReturnType<typeof startMissingDiverReport>>;
  try {
    result = await startMissingDiverReport(await getDb(), {
      shopId: shop.id,
      tripId,
      subject,
      actorPersonId: session.user.personId,
    });
  } catch {
    return { message: t("incidents.missingDiver.failed") };
  }
  if (!result.ok) {
    if (result.reason === "already_started") {
      return {
        message: t("incidents.missingDiver.alreadyStarted", { name: result.startedByName }),
      };
    }
    if (result.reason === "already_filed") {
      return { message: t("incidents.missingDiver.alreadyFiled", { name: result.filedByName }) };
    }
    if (result.reason === "not_missing") {
      return { message: t("incidents.missingDiver.notMissing") };
    }
    return { message: t("incidents.missingDiver.notAllowed") };
  }
  const checkpoint = manifestCheckpointParam(text(formData, "checkpoint"));
  const back = new URLSearchParams({ from: "manifest" });
  if (checkpoint) back.set("checkpoint", checkpoint);
  revalidateAndRedirect(
    shopPath(shopSlug, "trips", tripId),
    `${reportPath(shopSlug, tripId, result.reportId)}?${back}`,
  );
}

/** Save the draft's fields, read as wall-clock times in the shop's zone. */
export async function saveIncidentDraftAction(
  shopSlug: string,
  tripId: string,
  reportId: string,
  formData: FormData,
) {
  const { session, shop } = await requireShopSurface(shopSlug);
  requireIds(tripId, reportId);
  const back = reportPath(shopSlug, tripId, reportId);
  const parsed = parseIncidentDraft(
    {
      occurredOn: text(formData, "occurredOn"),
      occurredTime: text(formData, "occurredTime"),
      diveSiteId: text(formData, "diveSiteId"),
      locationText: text(formData, "locationText"),
      whatHappened: text(formData, "whatHappened"),
      kind: text(formData, "kind"),
      severity: text(formData, "severity"),
      firstAidGiven: text(formData, "firstAidGiven"),
      oxygenGiven: text(formData, "oxygenGiven"),
      oxygenMinutes: text(formData, "oxygenMinutes"),
      emergencyServicesCalled: text(formData, "emergencyServicesCalled"),
      handoverKind: text(formData, "handoverKind"),
      handoverDetail: text(formData, "handoverDetail"),
      handedOverOn: text(formData, "handedOverOn"),
      handedOverTime: text(formData, "handedOverTime"),
      followUp: text(formData, "followUp"),
    },
    (date, time) => {
      const wall = parseWallTime(date, time);
      return wall ? wallTimeToUtc(wall, shop.timezone) : null;
    },
  );
  // A refused field leaves the draft as it was; the staffer's typing is lost
  // with the redirect, so the notice names exactly which answer to fix.
  if (!parsed.ok) {
    redirect(noticeUrl(back, FIELD_NOTICE[parsed.reason], { form: "draft" }));
  }
  if (parsed.fields.diveSiteId !== null && !uuidParam(parsed.fields.diveSiteId)) {
    redirect(noticeUrl(back, "site-not-found", { form: "draft" }));
  }
  const result = await saveIncidentDraft(await getDb(), {
    shopId: shop.id,
    reportId,
    tripId,
    actorPersonId: session.user.personId,
    fields: parsed.fields,
  });
  settle(back, result, "saved", "draft");
}

/** File the draft: it stops changing from here. */
export async function fileIncidentReportAction(shopSlug: string, tripId: string, reportId: string) {
  const { session, shop } = await requireShopSurface(shopSlug);
  requireIds(tripId, reportId);
  const back = reportPath(shopSlug, tripId, reportId);
  const result = await fileIncidentReport(await getDb(), {
    shopId: shop.id,
    reportId,
    tripId,
    actorPersonId: session.user.personId,
  });
  settle(back, result, "filed", "file");
}

/** A dated note on a filed report. */
export async function addIncidentAddendumAction(
  shopSlug: string,
  tripId: string,
  reportId: string,
  formData: FormData,
) {
  const { session, shop } = await requireShopSurface(shopSlug);
  requireIds(tripId, reportId);
  const back = reportPath(shopSlug, tripId, reportId);
  const body = text(formData, "body");
  const result = await addIncidentAddendum(await getDb(), {
    shopId: shop.id,
    reportId,
    tripId,
    actorPersonId: session.user.personId,
    body,
  });
  settle(back, result, "addendum-added", "addenda");
}

/**
 * Name somebody on the draft. `who` is `booking:<id>`, `staff:<id>`, or
 * `outsider`, which takes the typed name.
 */
export async function addIncidentPersonAction(
  shopSlug: string,
  tripId: string,
  reportId: string,
  formData: FormData,
) {
  const { session, shop } = await requireShopSurface(shopSlug);
  requireIds(tripId, reportId);
  const back = reportPath(shopSlug, tripId, reportId);
  const who = text(formData, "who");
  const involvement = text(formData, "involvement");
  const [kind, id = ""] = who.split(":");
  let subject: IncidentSubject | null = null;
  if (kind === "booking" && uuidParam(id)) subject = { kind: "booking", bookingId: id };
  else if (kind === "staff" && uuidParam(id)) subject = { kind: "staff", personId: id };
  else if (kind === "outsider" && text(formData, "outsiderName").trim()) {
    subject = { kind: "outsider", name: text(formData, "outsiderName") };
  }
  if (!subject || !isIncidentInvolvement(involvement)) {
    redirect(noticeUrl(back, "nobody-chosen", { form: "people" }));
  }
  const result = await addIncidentPerson(await getDb(), {
    shopId: shop.id,
    reportId,
    tripId,
    actorPersonId: session.user.personId,
    subject,
    involvement,
  });
  settle(back, result, "person-added", "people");
}

/** Take somebody off the draft. */
export async function removeIncidentPersonAction(
  shopSlug: string,
  tripId: string,
  reportId: string,
  rowId: string,
) {
  const { session, shop } = await requireShopSurface(shopSlug);
  requireIds(tripId, reportId, rowId);
  const back = reportPath(shopSlug, tripId, reportId);
  const result = await removeIncidentPerson(await getDb(), {
    shopId: shop.id,
    reportId,
    tripId,
    actorPersonId: session.user.personId,
    rowId,
  });
  settle(back, result, "person-removed", "people");
}

/**
 * Delete an unfiled draft (an owner only; a filed report has no such door).
 * Lands on the departure's incident list, where the draft is no longer.
 */
export async function discardIncidentDraftAction(
  shopSlug: string,
  tripId: string,
  reportId: string,
) {
  const { session, shop } = await requireShopSurface(shopSlug);
  requireIds(tripId, reportId);
  const back = reportPath(shopSlug, tripId, reportId);
  const result = await discardIncidentDraft(await getDb(), {
    shopId: shop.id,
    reportId,
    tripId,
    actorPersonId: session.user.personId,
  });
  if (result.ok) {
    revalidateAndRedirect(
      shopPath(shopSlug, "trips", tripId),
      `${shopPath(shopSlug, "trips", tripId)}?view=details#incidents`,
    );
  }
  settle(back, result, "saved", "discard");
}

/** Put a legal hold on a report, or release it (an owner only). */
export async function setIncidentLegalHoldAction(
  shopSlug: string,
  tripId: string,
  reportId: string,
  held: boolean,
) {
  const { session, shop } = await requireShopSurface(shopSlug);
  requireIds(tripId, reportId);
  const back = reportPath(shopSlug, tripId, reportId);
  const result = await setIncidentLegalHold(await getDb(), {
    shopId: shop.id,
    reportId,
    tripId,
    actorPersonId: session.user.personId,
    held,
  });
  settle(back, result, held ? "hold-set" : "hold-released", "hold");
}
