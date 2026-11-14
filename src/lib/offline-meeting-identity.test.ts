import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { authSecret } from "./auth-secret";
import {
  signOfflineMeetingIdentity,
  verifyOfflineMeetingIdentity,
} from "./offline-meeting-identity";
import * as receiptSecrets from "./offline-receipt-secrets";
import { deriveLabelKey, signPayload } from "./signed-token";

it("binds an offline meeting to the shop, trip, snapshot, identity and captured day", () => {
  const shopId = randomUUID();
  const tripId = randomUUID();
  const snapshotId = randomUUID();
  const meetingId = randomUUID();
  const datasetIncarnation = randomUUID();
  const token = signOfflineMeetingIdentity({
    scheduleGeneration: 0,
    datasetIncarnation,
    shopId,
    tripId,
    snapshotId,
    meetingId,
    startsAt: new Date("2026-01-01T00:00:00Z"),
    endsAt: new Date("2026-01-01T01:00:00Z"),
    meetingDay: 1,
  });
  expect(
    verifyOfflineMeetingIdentity({
      scheduleGeneration: 0,
      datasetIncarnation,
      token,
      shopId,
      tripId,
      snapshotId,
      meetingDay: 1,
    }),
  ).toEqual({
    meetingId,
    startsAt: Date.parse("2026-01-01T00:00:00Z"),
    endsAt: Date.parse("2026-01-01T01:00:00Z"),
  });
  for (const changed of [
    { shopId: randomUUID(), tripId, snapshotId, meetingDay: 1 },
    { shopId, tripId: randomUUID(), snapshotId, meetingDay: 1 },
    { shopId, tripId, snapshotId: randomUUID(), meetingDay: 1 },
    { shopId, tripId, snapshotId, meetingDay: 2 },
    { shopId, tripId, snapshotId, meetingDay: 1, datasetIncarnation: randomUUID() },
  ])
    expect(
      verifyOfflineMeetingIdentity({
        scheduleGeneration: 0,
        datasetIncarnation,
        ...changed,
        token,
      }),
    ).toBeNull();
  expect(
    verifyOfflineMeetingIdentity({
      scheduleGeneration: 0,
      datasetIncarnation,
      token: `${randomUUID()}.1.invalid`,
      shopId,
      tripId,
      snapshotId,
      meetingDay: 1,
    }),
  ).toBeNull();
  expect(
    verifyOfflineMeetingIdentity({
      scheduleGeneration: 0,
      datasetIncarnation,
      token: undefined,
      shopId,
      tripId,
      snapshotId,
      meetingDay: 1,
    }),
  ).toBeNull();
});

it("verifies a prior key only while configured, without broadening scope", () => {
  const scope = {
    datasetIncarnation: randomUUID(),
    shopId: randomUUID(),
    tripId: randomUUID(),
    snapshotId: randomUUID(),
    meetingDay: 1,
  };
  const token = signOfflineMeetingIdentity({
    scheduleGeneration: 0,
    ...scope,
    meetingId: randomUUID(),
    startsAt: new Date("2026-01-01T00:00:00Z"),
    endsAt: new Date("2026-01-01T01:00:00Z"),
  });
  const previous = receiptSecrets.offlineReceiptSecrets();
  const keys = vi
    .spyOn(receiptSecrets, "offlineReceiptSecrets")
    .mockReturnValue(["new key", ...previous]);
  try {
    expect(verifyOfflineMeetingIdentity({ scheduleGeneration: 0, ...scope, token })).not.toBeNull();
    expect(
      verifyOfflineMeetingIdentity({
        scheduleGeneration: 0,
        ...scope,
        shopId: randomUUID(),
        token,
      }),
    ).toBeNull();
    keys.mockReturnValue(["new key"]);
    expect(verifyOfflineMeetingIdentity({ scheduleGeneration: 0, ...scope, token })).toBeNull();
  } finally {
    keys.mockRestore();
  }
});

it("rejects tampered meeting identity, day, window, tag, and overlong proofs", () => {
  const scope = {
    datasetIncarnation: randomUUID(),
    shopId: randomUUID(),
    tripId: randomUUID(),
    snapshotId: randomUUID(),
    meetingDay: 1,
  };
  const token = signOfflineMeetingIdentity({
    scheduleGeneration: 0,
    ...scope,
    meetingId: randomUUID(),
    startsAt: new Date("2026-01-01T00:00:00Z"),
    endsAt: new Date("2026-01-01T01:00:00Z"),
  });
  const parts = token.split(".");
  const substitutions = [randomUUID(), "2", "1", "2", "1", "invalid"];
  for (let index = 0; index < parts.length; index += 1) {
    const altered = [...parts];
    altered[index] = substitutions[index];
    expect(
      verifyOfflineMeetingIdentity({ scheduleGeneration: 0, ...scope, token: altered.join(".") }),
    ).toBeNull();
  }
  expect(
    verifyOfflineMeetingIdentity({ scheduleGeneration: 0, ...scope, token: "x".repeat(129) }),
  ).toBeNull();
  for (const meetingDay of [-1, 1001, 0.5])
    expect(
      verifyOfflineMeetingIdentity({ scheduleGeneration: 0, ...scope, meetingDay, token }),
    ).toBeNull();
});

it.each([
  [-10_000, -1_000],
  [-1_000, 1_000],
  [0, 1_000],
  [-8_640_000_000_000_000, 0],
  [0, 8_640_000_000_000_000],
])("round trips signed meeting instants %i through %i", (startsAt, endsAt) => {
  const scope = {
    datasetIncarnation: randomUUID(),
    shopId: randomUUID(),
    tripId: randomUUID(),
    snapshotId: randomUUID(),
    meetingDay: 0,
  };
  const meetingId = randomUUID();
  const token = signOfflineMeetingIdentity({
    scheduleGeneration: 0,
    ...scope,
    meetingId,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
  });
  expect(verifyOfflineMeetingIdentity({ scheduleGeneration: 0, ...scope, token })).toEqual({
    meetingId,
    startsAt,
    endsAt,
  });
});

it("refuses invalid windows and correctly signed noncanonical instants", () => {
  const scope = {
    datasetIncarnation: randomUUID(),
    shopId: randomUUID(),
    tripId: randomUUID(),
    snapshotId: randomUUID(),
    meetingDay: 1000,
  };
  const meetingId = randomUUID();
  const start = new Date(0);
  expect(() =>
    signOfflineMeetingIdentity({
      scheduleGeneration: 0,
      ...scope,
      meetingId,
      startsAt: new Date(Number.NaN),
      endsAt: start,
    }),
  ).toThrow();
  expect(() =>
    signOfflineMeetingIdentity({
      scheduleGeneration: 0,
      ...scope,
      meetingId,
      startsAt: start,
      endsAt: start,
    }),
  ).toThrow();
  expect(() =>
    signOfflineMeetingIdentity({
      scheduleGeneration: 0,
      ...scope,
      meetingId,
      startsAt: new Date(1),
      endsAt: start,
    }),
  ).toThrow();
  if (!authSecret) throw new Error("test signing secret missing");
  for (const starts of ["00", "-0"]) {
    const ends = "1";
    const tag = signPayload(
      deriveLabelKey(authSecret, "diveday-offline-meeting-identity-v2"),
      JSON.stringify([
        scope.shopId,
        scope.tripId,
        scope.snapshotId,
        scope.meetingDay,
        0,
        scope.datasetIncarnation,
        meetingId,
        starts,
        ends,
      ]),
    );
    expect(
      verifyOfflineMeetingIdentity({
        scheduleGeneration: 0,
        ...scope,
        token: `${meetingId}.${scope.meetingDay}.${starts}.${ends}.0.${tag}`,
      }),
    ).toBeNull();
  }
  const token = signOfflineMeetingIdentity({
    scheduleGeneration: 0,
    ...scope,
    meetingId,
    startsAt: start,
    endsAt: new Date(1),
  });
  expect(verifyOfflineMeetingIdentity({ scheduleGeneration: 0, ...scope, token })).not.toBeNull();
});

it("bounds the largest generation proof and refuses a proof without a generation", () => {
  const scope = {
    datasetIncarnation: randomUUID(),
    shopId: randomUUID(),
    tripId: randomUUID(),
    snapshotId: randomUUID(),
    meetingDay: 1000,
    scheduleGeneration: 2_147_483_647,
  };
  const token = signOfflineMeetingIdentity({
    ...scope,
    meetingId: randomUUID(),
    startsAt: new Date(-8_640_000_000_000_000),
    endsAt: new Date(8_640_000_000_000_000),
  });
  expect(token.length).toBeLessThanOrEqual(128);
  expect(verifyOfflineMeetingIdentity({ ...scope, token })).not.toBeNull();
  const parts = token.split(".");
  parts.splice(4, 1);
  expect(verifyOfflineMeetingIdentity({ ...scope, token: parts.join(".") })).toBeNull();
  expect(verifyOfflineMeetingIdentity({ ...scope, scheduleGeneration: 0, token })).toBeNull();
});

it("refuses a valid v1 proof after introducing dataset incarnation", () => {
  if (!authSecret) throw new Error("test signing secret missing");
  const scope = {
    shopId: randomUUID(),
    tripId: randomUUID(),
    snapshotId: randomUUID(),
    meetingDay: 0,
    scheduleGeneration: 0,
    datasetIncarnation: randomUUID(),
  };
  const meetingId = randomUUID();
  const starts = "0";
  const ends = "rs";
  const oldTag = signPayload(
    deriveLabelKey(authSecret, "diveday-offline-meeting-identity-v1"),
    JSON.stringify([
      scope.shopId,
      scope.tripId,
      scope.snapshotId,
      scope.meetingDay,
      scope.scheduleGeneration,
      meetingId,
      starts,
      ends,
    ]),
  );
  expect(
    verifyOfflineMeetingIdentity({
      ...scope,
      token: `${meetingId}.0.${starts}.${ends}.0.${oldTag}`,
    }),
  ).toBeNull();
});
