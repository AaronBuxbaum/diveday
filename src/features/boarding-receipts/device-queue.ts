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
type PreparedTap = Readonly<{ eventId: string; serialized: string }>;
type CaptureResult =
  | { status: "disabled" | "not_saved" | "not_confirmed"; attempt: PreparedTap }
  | { status: "invalid" }
  | { status: "retained_locally"; eventId: string };
type ObservationResult =
  | {
      status:
        | "disabled"
        | "same_attempt_observed"
        | "different_or_unreadable"
        | "absent_or_unavailable";
      attempt: PreparedTap;
    }
  | { status: "invalid" };
const DB_NAME = "diveday-dock-queue-disabled-v1";
const preparedAttempts = new WeakSet<PreparedTap>();

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

export function prepareDockTap(input: TapInput): PreparedTap | null {
  try {
    if (
      !validId(input.shopId) ||
      !validId(input.tripId) ||
      !validId(input.bookingId) ||
      !validId(input.actorId)
    )
      return null;
    const meeting = input.originalMeeting;
    if (!meeting || (meeting.kind !== "unknown" && meeting.kind !== "asserted")) return null;
    if (
      meeting.kind === "asserted" &&
      (!validId(meeting.generationId) || !validId(meeting.meetingId))
    )
      return null;
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
    const attempt = Object.freeze({ eventId, serialized: JSON.stringify(event) });
    preparedAttempts.add(attempt);
    return attempt;
  } catch {
    return null;
  }
}

/** The attempt is memory only until the transaction completes. */
export async function persistPreparedDockTap(attempt: PreparedTap): Promise<CaptureResult> {
  if (!dockQueueEnabled()) return { status: "disabled", attempt };
  if (!preparedAttempts.has(attempt)) return { status: "invalid" };
  const { eventId, serialized } = attempt;
  let writeStarted = false;
  try {
    const bytes = new TextEncoder().encode(serialized);
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
      writeStarted = true;
      tx.objectStore("events").add({ key, iv, ciphertext }, eventId);
      await done;
    } finally {
      db.close();
    }
    return { status: "retained_locally", eventId };
  } catch {
    return { status: writeStarted ? "not_confirmed" : "not_saved", attempt };
  }
}

export async function captureDockTap(input: TapInput): Promise<CaptureResult> {
  const attempt = prepareDockTap(input);
  if (!attempt) return { status: "invalid" };
  return persistPreparedDockTap(attempt);
}

/** A historical read only: this is neither a receipt nor proof the row still exists. */
export async function observePreparedDockTap(attempt: PreparedTap): Promise<ObservationResult> {
  if (!dockQueueEnabled()) return { status: "disabled", attempt };
  if (!preparedAttempts.has(attempt)) return { status: "invalid" };
  let row: unknown;
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      let blocked = false;
      // Reading must never create or upgrade a database.
      request.onupgradeneeded = () => request.transaction?.abort();
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
    try {
      const tx = db.transaction("events", "readonly");
      const done = transactionDone(tx);
      const request = tx.objectStore("events").get(attempt.eventId);
      request.onsuccess = () => {
        row = request.result;
      };
      await done;
    } finally {
      db.close();
    }
  } catch {
    return { status: "absent_or_unavailable", attempt };
  }
  if (row === undefined) return { status: "absent_or_unavailable", attempt };
  try {
    if (
      !row ||
      typeof row !== "object" ||
      !("key" in row) ||
      !("iv" in row) ||
      !("ciphertext" in row)
    )
      throw new Error("invalid row");
    const { key, iv, ciphertext } = row as {
      key: CryptoKey;
      iv: Uint8Array<ArrayBuffer>;
      ciphertext: ArrayBuffer;
    };
    if (
      key?.type !== "secret" ||
      key.extractable ||
      key.algorithm.name !== "AES-GCM" ||
      !ArrayBuffer.isView(iv) ||
      iv.byteLength !== 12
    )
      throw new Error("invalid row");
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(
            JSON.stringify(["dock-tap-v1", attempt.eventId]),
          ),
        },
        key,
        ciphertext,
      ),
    );
    const expected = new TextEncoder().encode(attempt.serialized);
    if (plain.length !== expected.length || !plain.every((byte, i) => byte === expected[i]))
      throw new Error("different attempt");
    return { status: "same_attempt_observed", attempt };
  } catch {
    return { status: "different_or_unreadable", attempt };
  }
}
