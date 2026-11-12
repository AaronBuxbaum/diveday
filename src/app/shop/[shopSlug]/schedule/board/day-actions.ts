"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { isLockWaitRefusal } from "@/db/lock-bounds";
import { recordTripActivity } from "@/db/operations";
import { moveTripCrew } from "@/db/trips";
import { readScheduleDay } from "@/features/schedule-day";
import { moveParty, moveSeat } from "@/features/seat-diver";
import { requireShopSurface } from "@/features/session";
import { isShopDayParam } from "@/lib/calendar-date";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

function redirectIfBusy(error: unknown, back: string): never {
  if (isLockWaitRefusal(error)) redirect(`${back}&notice=busy`);
  throw error;
}

export async function moveDayPersonAction(shopSlug: string, day: string, form: FormData) {
  const { session, shop } = await requireShopSurface(shopSlug);
  const path = shopPath(shopSlug, "schedule", "board");
  const back = `${path}?view=day&day=${encodeURIComponent(day)}`;
  const from = uuidParam(String(form.get("from") ?? ""));
  const to = uuidParam(String(form.get("to") ?? ""));
  const person = uuidParam(String(form.get("person") ?? ""));
  const kind = form.get("kind");
  const fromProof = String(form.get("fromProof") ?? "");
  const toProof = String(form.get("toProof") ?? "");
  if (
    !isShopDayParam(day) ||
    !/^[A-Za-z0-9_-]{43}$/.test(fromProof) ||
    !/^[A-Za-z0-9_-]{43}$/.test(toProof) ||
    !from ||
    !to ||
    !person ||
    from === to ||
    (kind !== "crew" && kind !== "diver")
  )
    redirect(path);
  const db = await getDb();
  const rows = await readScheduleDay(db, shop.id, day, shop.timezone);
  const source = rows.find((row) => row.tripId === from);
  const target = rows.find((row) => row.tripId === to);
  if (!source || !target) redirect(`${back}&notice=refused`);
  let notice = "refused";
  if (kind === "crew") {
    const member = source.crew.find((entry) => entry.id === person);
    if (!member) redirect(`${back}&notice=refused`);
    const moved = await moveTripCrew(db, {
      shopId: shop.id,
      fromTripId: from,
      toTripId: to,
      personId: person,
      actorPersonId: session.user.personId,
      expectedDay: { day, timeZone: shop.timezone, fromProof, toProof },
    }).catch((error: unknown) => redirectIfBusy(error, back));
    if (moved.ok) {
      for (const [tripId, code] of [
        [from, "crew_removed"],
        [to, "crew_assigned"],
      ] as const) {
        await recordTripActivity(db, {
          shopId: shop.id,
          tripId,
          actorPersonId: session.user.personId,
          subjectPersonId: person,
          entry: { code, crew: member.name },
        });
      }
      notice = "moved";
    } else notice = moved.refusal === "crew_clash" ? "clash" : "refused";
  } else {
    const seat = source.divers.find((entry) => entry.id === person);
    if (!seat) redirect(`${back}&notice=refused`);
    const common = {
      shopId: shop.id,
      fromTripId: from,
      toTripId: to,
      actorPersonId: session.user.personId,
      rejectScheduleClashes: true,
      expectedDay: { day, timeZone: shop.timezone, fromProof, toProof },
    };
    const leads = source.divers.some((entry) => entry.partyLeadBookingId === seat.id);
    if (leads) {
      const moved = await moveParty(db, { ...common, leadBookingId: seat.id }).catch(
        (error: unknown) => redirectIfBusy(error, back),
      );
      notice = moved.ok
        ? moved.seats.some(
            (item) =>
              item.notice === "failed" ||
              item.waiver === "failed" ||
              item.waiver === "not_delivered" ||
              item.owedCents > 0 ||
              item.flySafe === "failed" ||
              item.flySafe.unreached.length > 0,
          )
          ? "attention"
          : "moved"
        : moved.outcome.reason === "schedule_clash" || moved.outcome.reason === "already_booked"
          ? "clash"
          : "refused";
    } else {
      const moved = await moveSeat(db, { ...common, bookingId: seat.id }).catch((error: unknown) =>
        redirectIfBusy(error, back),
      );
      notice = moved.ok
        ? moved.notice === "failed" ||
          moved.waiver === "failed" ||
          moved.waiver === "not_delivered" ||
          moved.owedCents > 0 ||
          moved.flySafe === "failed" ||
          moved.flySafe.unreached.length > 0
          ? "attention"
          : "moved"
        : moved.reason === "schedule_clash" || moved.reason === "already_booked"
          ? "clash"
          : "refused";
    }
  }
  revalidatePath(path);
  revalidatePath(shopPath(shopSlug, "trips", from));
  revalidatePath(shopPath(shopSlug, "trips", to));
  redirect(`${back}&notice=${notice}`);
}
