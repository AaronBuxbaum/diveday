"use server";

import { cookies } from "next/headers";
import {
  acknowledgeReturningDiverReceipt,
  readReturningDiverReceipt,
  revokeReturningDiverReceipt,
} from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { RETURNING_DIVER_RECEIPT_COOKIE } from "@/lib/returning-diver";

function validReceiptToken(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{20,128}$/.test(value));
}

/** The HttpOnly receipt is the sole authority; callers cannot select a shop or diver. */
export async function prepareReturningDiverMemory(): Promise<{
  kind: "ready";
  receiptId: string;
  shopSlug: string;
  diver: { fullName: string; email: string };
  expiresAt: number;
} | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(RETURNING_DIVER_RECEIPT_COOKIE)?.value;
    if (!validReceiptToken(token)) return null;
    const memory = await readReturningDiverReceipt(await getDb(), { receiptToken: token });
    if (memory)
      return {
        kind: "ready",
        receiptId: memory.receiptId,
        shopSlug: memory.shopSlug,
        diver: memory.diver,
        expiresAt: memory.memoryExpiresAt,
      };
    // Leave an invalid cookie in place until its short Max-Age expires. A
    // response-time deletion can race a newer booking's Set-Cookie response
    // and erase that newer receipt. Invalid receipts are harmless: the DB
    // lookup returns no identity, and every receipt expires within 24 hours.
    return null;
  } catch {
    return null;
  }
}

/** Called only after the browser confirms the shop-scoped localStorage write. */
export async function acknowledgeReturningDiverMemory(expectedReceiptId: string): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(RETURNING_DIVER_RECEIPT_COOKIE)?.value;
    if (!validReceiptToken(token)) return false;
    const acknowledged = await acknowledgeReturningDiverReceipt(await getDb(), {
      receiptToken: token,
      expectedReceiptId,
    });
    // Do not delete the shared cookie here. This response may arrive after a
    // newer booking has replaced it in the browser. The acknowledged DB row
    // makes this token inert; Max-Age bounds how long it remains on-device.
    return acknowledged;
  } catch {
    return false;
  }
}

/** A clear revokes only the receipt ID held in the current HttpOnly cookie. */
export async function revokeClearedReturningDiverReceipt(
  shopSlug: string,
  expectedReceiptId: string,
): Promise<boolean> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shopSlug)) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedReceiptId))
    return false;
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(RETURNING_DIVER_RECEIPT_COOKIE)?.value;
    if (!validReceiptToken(token)) return false;
    const revoked = await revokeReturningDiverReceipt(await getDb(), {
      receiptToken: token,
      expectedReceiptId,
      shopSlug,
    });
    // Revocation is scoped to this receipt row. Avoid a response-time cookie
    // deletion that could erase a newer booking's replacement receipt.
    return revoked;
  } catch {
    return false;
  }
}
