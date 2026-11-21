"use server";

import { z } from "zod";
import { getShopById, setShopTripDefaults } from "@/db/shops";
import { defineAction, land } from "@/features/platform/server-action";
import { getTripLens } from "@/features/trips/trip-lenses";
import { MAX_PRICE_MINOR_UNITS, majorToMinor } from "@/lib/money";
import { SETTINGS_GATE } from "../action-gates";

const form = z.object({
  deposit: z.string(),
  cancellation: z.string(),
  minimum: z.string(),
  snorkeler: z.string(),
  rider: z.string(),
  lensId: z.string(),
});

export const saveTripDefaultsAction = defineAction({
  gate: [SETTINGS_GATE],
  input: form,
  async run({ db, shopId, path }, input) {
    const page = path("settings", "trip-defaults");
    const shop = await getShopById(db, shopId);
    if (!shop) return land(page, "invalid");
    const amount = (value: string) => {
      if (!value.trim()) return null;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return undefined;
      const minor = majorToMinor(n, shop.currency);
      return minor <= MAX_PRICE_MINOR_UNITS ? minor : undefined;
    };
    const integer = (value: string, min: number, max: number) => {
      if (!value.trim()) return null;
      if (!/^\d+$/.test(value.trim())) return undefined;
      const n = Number(value);
      return n >= min && n <= max ? n : undefined;
    };
    const depositCents = amount(input.deposit);
    const snorkelerPriceCents = amount(input.snorkeler);
    const riderPriceCents = amount(input.rider);
    const cancellationWindowHours = integer(input.cancellation, 0, 720);
    const minimumBookings = integer(input.minimum, 1, 60);
    if (
      depositCents === undefined ||
      snorkelerPriceCents === undefined ||
      riderPriceCents === undefined ||
      cancellationWindowHours === undefined ||
      minimumBookings === undefined
    )
      return land(page, "invalid");
    if (
      input.lensId &&
      (!z.uuid().safeParse(input.lensId).success || !(await getTripLens(db, shopId, input.lensId)))
    )
      return land(page, "invalid");
    await setShopTripDefaults(db, shopId, {
      depositCents: depositCents,
      snorkelerPriceCents: snorkelerPriceCents,
      riderPriceCents: riderPriceCents,
      cancellationWindowHours: cancellationWindowHours,
      minimumBookings: minimumBookings,
      lensId: input.lensId || null,
    });
    return land(page, "saved");
  },
});
