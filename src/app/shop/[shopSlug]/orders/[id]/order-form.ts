import { z } from "zod";
import { parseForm } from "@/lib/form-parse";
import { uuidParam } from "@/lib/uuid";

/**
 * Every money control on an order posts the order id; the refund adds what to
 * send back. Read through one parser (issue #2233), kept beside the route so
 * the route file stays its length.
 */
const orderForm = z.object({
  orderId: z.string().default(""),
  amountMajor: z.string().optional(),
  collection: z.string().optional(),
  roomNumber: z.string().optional(),
  roomHotel: z.string().optional(),
});

/** The posted order id narrowed to a uuid, or "" — never a 500 on junk. */
export function postedOrderId(formData: FormData): string {
  const parsed = parseForm(orderForm, formData);
  return (parsed.ok && uuidParam(parsed.data.orderId)) || "";
}

/**
 * The typed refund amount, trimmed; "" means the whole remaining balance. A
 * form that does not read (a repeated field) or a figure that is not a finite
 * number is `null`, never "": that would turn a malformed request into a full
 * refund. The caller refuses `null` as an invalid amount.
 */
export function postedRefundAmount(formData: FormData): string | null {
  const parsed = parseForm(orderForm, formData);
  if (!parsed.ok) return null;
  const typed = (parsed.data.amountMajor ?? "").trim();
  return typed && !Number.isFinite(Number(typed)) ? null : typed;
}

/**
 * How the money was taken, from the Record payment controls: `cash`,
 * `card_machine` or `room_charge`, and nothing else; anything else is `null`
 * and refused.
 */
export function postedCollection(
  formData: FormData,
): "cash" | "card_machine" | "room_charge" | null {
  const parsed = parseForm(orderForm, formData);
  const value = parsed.ok ? parsed.data.collection : undefined;
  return value === "cash" || value === "card_machine" || value === "room_charge" ? value : null;
}

/**
 * The room a room charge went to, trimmed: `null` without a room number. The
 * writer bounds the lengths (`ROOM_NUMBER_MAX`, `ROOM_HOTEL_MAX`).
 */
export function postedRoom(formData: FormData): { number: string; hotel: string | null } | null {
  const parsed = parseForm(orderForm, formData);
  if (!parsed.ok) return null;
  const number = (parsed.data.roomNumber ?? "").trim();
  const hotel = (parsed.data.roomHotel ?? "").trim();
  return number ? { number, hotel: hotel || null } : null;
}
