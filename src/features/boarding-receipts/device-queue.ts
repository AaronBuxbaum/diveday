"use client";

import { nowDate } from "@/lib/clock";
import { dockQueueEnabled } from "./device-queue-gate";

/**
 * Disabled, unconnected capture primitive. This does not authenticate the
 * asserted context, send anything, acknowledge a server receipt, or implement
 * recovery, selective erasure, or protection from older shells. Each stored
 * key remains usable by same-origin code. Do not expose it to staff until all
 * those boundaries and a compatible writer drain are independently verified.
 */
type Meeting = { kind: "unknown" } | { kind: "asserted"; generationId: string; meetingId: string };
type TapInput = {
  shopId: string;
  tripId: string;
  bookingId: string;
  actorId: string;
  originalMeeting: Meeting;
};
type CaptureResult =
  | { status: "disabled" | "not_saved" }
  | { status: "retained_locally"; eventId: string };
const DB_NAME = "diveday-dock-queue-disabled-v1";

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    new TextDecoder().decode(new TextEncoder().encode(value)) === value
  );
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore("events");
    request.onblocked = () => {
      blocked = true;
      reject(new Error("blocked"));
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
}
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("failed"));
  });
}

export async function captureDockTap(input: TapInput): Promise<CaptureResult> {
  if (!dockQueueEnabled()) return { status: "disabled" };
  try {
    if (
      !validId(input.shopId) ||
      !validId(input.tripId) ||
      !validId(input.bookingId) ||
      !validId(input.actorId)
    )
      return { status: "not_saved" };
    const meeting = input.originalMeeting;
    if (!meeting || (meeting.kind !== "unknown" && meeting.kind !== "asserted"))
      return { status: "not_saved" };
    if (
      meeting.kind === "asserted" &&
      (!validId(meeting.generationId) || !validId(meeting.meetingId))
    )
      return { status: "not_saved" };
    const eventId = crypto.randomUUID();
    const event = {
      eventId,
      kind: "dock_sighting",
      shopId: input.shopId,
      tripId: input.tripId,
      bookingId: input.bookingId,
      actorId: input.actorId,
      originalMeeting:
        meeting.kind === "unknown"
          ? { kind: "unknown" }
          : { kind: "asserted", generationId: meeting.generationId, meetingId: meeting.meetingId },
      capturedAt: nowDate().toISOString(),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(event));
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(JSON.stringify(["dock-tap-v1", eventId])),
      },
      key,
      bytes,
    );
    const db = await database();
    try {
      const tx = db.transaction("events", "readwrite");
      const done = transactionDone(tx);
      tx.objectStore("events").add({ key, iv, ciphertext }, eventId);
      await done;
    } finally {
      db.close();
    }
    return { status: "retained_locally", eventId };
  } catch {
    return { status: "not_saved" };
  }
}
