import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { mergeDiverRecords } from "@/db/diver-merge";
import { issueMagicSignIn, startMagicSignIn } from "@/db/magic-sign-in";
import {
  bookingCapabilities,
  bookings,
  people,
  personRoles,
  privatePersonPhotoUploads,
  shops,
  trips,
  userAccounts,
} from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { removeStaffMember } from "../../accounts/staff-accounts";
import { anonymizeDiver } from "../../records/anonymize";
import { cleanupPrivatePersonPhotos } from "./cleanup";
import { changePrivatePersonPhoto } from "./write";

const { requests } = vi.hoisted(() => ({ requests: [] as string[] }));
// Stub only the outbound S3 transport; all lifecycle and DB functions are real.
vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(public input: unknown) {}
  }
  return {
    DeleteObjectCommand: class extends Command {},
    DeleteObjectsCommand: class extends Command {},
    ListObjectVersionsCommand: class extends Command {},
    S3Client: class {
      async send(command: Command) {
        requests.push(command.constructor.name);
        return {};
      }
      destroy() {}
    },
  };
});

beforeEach(() => {
  requests.length = 0;
  vi.stubEnv("MEDIA_BUCKET_NAME", "test-photo-bucket");
  vi.stubEnv("MEDIA_AWS_REGION", "us-east-1");
  vi.stubEnv("MEDIA_AWS_ACCESS_KEY_ID", "test");
  vi.stubEnv("MEDIA_AWS_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("MEDIA_PUBLIC_URL_BASE", "https://media.example.com");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function fixture() {
  const pg = await postgresTestDb();
  const [shop] = await pg.db
    .insert(shops)
    .values({ name: "Photo Race", slug: "photo-race", timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop missing");
  const [person, owner] = await pg.db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Photo Diver" },
      { shopId: shop.id, fullName: "Owner" },
    ])
    .returning();
  if (!person || !owner) throw new Error("person missing");
  await pg.db.insert(personRoles).values({ personId: owner.id, role: "owner" });
  await pg.db.insert(userAccounts).values({
    personId: owner.id,
    email: "owner@example.org",
    emailVerified: true,
    emailVerifiedAt: nowDate(),
  });
  const now = nowDate();
  const [trip] = await pg.db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Photo",
      startsAt: new Date(now.getTime() + 172800000),
      endsAt: new Date(now.getTime() + 180000000),
      capacity: 3,
    })
    .returning();
  if (!trip) throw new Error("trip missing");
  const [booking] = await pg.db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
    .returning();
  if (!booking) throw new Error("booking missing");
  const capability = await issueBookingCapability(pg.db, {
    shopId: shop.id,
    bookingId: booking.id,
    purpose: "readiness",
    delivered: true,
  });
  if (!capability) throw new Error("capability missing");
  const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } })
    .jpeg()
    .toBuffer();
  const bytes = Uint8Array.from(image).buffer;
  const file = { filename: "private-name.jpg", contentType: "image/jpeg", bytes };
  const actor = { kind: "readiness" as const, token: capability.token };
  return { pg, shop, person, owner, booking, file, actor };
}

describePostgres("private photo lifecycle races", () => {
  it("fails promptly rather than deadlocking with staff removal, then refuses the removed staffer", async () => {
    const f = await fixture();
    const [staff] = await f.pg.db
      .insert(people)
      .values({ shopId: f.shop.id, fullName: "Crew" })
      .returning();
    if (!staff) throw new Error("staff missing");
    const [account] = await f.pg.db
      .insert(userAccounts)
      .values({ personId: staff.id, email: "crew@example.org" })
      .returning();
    if (!account) throw new Error("staff account missing");
    await f.pg.db.insert(personRoles).values({ personId: staff.id, role: "instructor" });
    const gate = await holdRowLock(
      f.pg,
      sql`select user_accounts.id from user_accounts join people on people.id = user_accounts.person_id where user_accounts.id = ${account.id} for share of user_accounts for update of people`,
    );
    const removal = removeStaffMember(f.pg.connect(), {
      shopId: f.shop.id,
      personId: staff.id,
      userAccountId: account.id,
    }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await waitForLockWaiters(f.pg.db, 1);
    const actor = {
      kind: "staff" as const,
      shopId: f.shop.id,
      personId: f.person.id,
      staffPersonId: staff.id,
    };
    try {
      expect(await changePrivatePersonPhoto(f.pg.connect(), { actor, file: null })).toBe("failed");
    } finally {
      await gate.release();
    }
    expect(await removal).toEqual({ value: { ok: true } });
    expect(await changePrivatePersonPhoto(f.pg.db, { actor, file: null })).toBe("invalid");
    const [person] = await f.pg.db.select().from(people).where(eq(people.id, f.person.id));
    expect(person?.diverPhotoSuppressed).toBe(false);
  });

  it("serializes with the account-then-person locks of real sign-in", async () => {
    const f = await fixture();
    const issued = await issueMagicSignIn(f.pg.db, "owner@example.org");
    if (!issued) throw new Error("sign-in link missing");
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const signIn = startMagicSignIn(
      f.pg.connect(),
      { token: issued.token, previousHandle: null },
      async () => {
        entered();
        await gate;
        return "session";
      },
    );
    await started;
    const actor = {
      kind: "staff" as const,
      shopId: f.shop.id,
      personId: f.person.id,
      staffPersonId: f.owner.id,
    };
    const photo = changePrivatePersonPhoto(f.pg.connect(), { actor, file: null });
    try {
      await waitForLockWaiters(f.pg.db, 1);
    } finally {
      release();
    }
    expect((await signIn).status).toBe("signed_in");
    expect(await photo).toBe("saved");
  });

  it("keeps an uncertain upload on a merged shell visible to survivor erasure", async () => {
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("lost response");
      }),
    );
    expect(await changePrivatePersonPhoto(f.pg.db, { actor: f.actor, file: f.file })).toBe(
      "failed",
    );
    const [survivor] = await f.pg.db
      .insert(people)
      .values({ shopId: f.shop.id, fullName: "Photo Diver" })
      .returning();
    if (!survivor) throw new Error("survivor missing");
    await f.pg.db.insert(personRoles).values([
      { personId: f.person.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);
    const merged = await mergeDiverRecords({
      db: f.pg.db,
      shopId: f.shop.id,
      personId: f.person.id,
      survivorId: survivor.id,
      actorPersonId: f.owner.id,
    });
    expect(merged).toMatchObject({ ok: true });
    const erased = await anonymizeDiver(f.pg.db, {
      shopId: f.shop.id,
      personId: survivor.id,
      actorPersonId: f.owner.id,
    });
    expect(erased).toMatchObject({ ok: true, owedMediaDeletions: expect.any(Number) });
    if (!erased.ok) throw new Error("erasure failed");
    expect(erased.owedMediaDeletions).toBeGreaterThan(0);
    const [upload] = await f.pg.db.select().from(privatePersonPhotoUploads);
    expect(upload).toMatchObject({
      personId: survivor.id,
      state: "retired",
      putFinished: false,
      cleanAfterPut: false,
    });
  });

  it("refuses undelivered links and held identities before uploading", async () => {
    const f = await fixture();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const undelivered = await issueBookingCapability(f.pg.db, {
      shopId: f.shop.id,
      bookingId: f.booking.id,
      purpose: "readiness",
      delivered: false,
    });
    if (!undelivered) throw new Error("undelivered capability missing");
    expect(
      await changePrivatePersonPhoto(f.pg.db, {
        actor: { kind: "readiness", token: undelivered.token },
        file: f.file,
      }),
    ).toBe("invalid");
    await f.pg.db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate() })
      .where(eq(bookings.id, f.booking.id));
    expect(await changePrivatePersonPhoto(f.pg.db, { actor: f.actor, file: f.file })).toBe(
      "invalid",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await f.pg.db.select().from(privatePersonPhotoUploads)).toHaveLength(0);
  });

  it("serializes two replacements and leaves precisely the current object active", async () => {
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    expect(await changePrivatePersonPhoto(f.pg.db, { actor: f.actor, file: f.file })).toBe("saved");
    const gate = await holdRowLock(
      f.pg,
      sql`select id from people where id = ${f.person.id} for update`,
    );
    const first = changePrivatePersonPhoto(f.pg.connect(), { actor: f.actor, file: f.file });
    const second = changePrivatePersonPhoto(f.pg.connect(), { actor: f.actor, file: f.file });
    await waitForLockWaiters(f.pg.db, 2);
    await gate.release();
    expect(await Promise.all([first, second])).toEqual(["saved", "saved"]);
    const [person] = await f.pg.db.select().from(people).where(eq(people.id, f.person.id));
    const uploads = await f.pg.db.select().from(privatePersonPhotoUploads);
    expect(uploads).toHaveLength(3);
    expect(uploads.filter((row) => row.state === "active")).toMatchObject([
      { url: person?.diverPhotoPath },
    ]);
    expect(uploads.filter((row) => row.state === "retired")).toHaveLength(2);
  });

  it("does not publish an upload after erasure wins during the PUT", async () => {
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    expect(await changePrivatePersonPhoto(f.pg.db, { actor: f.actor, file: f.file })).toBe("saved");
    let release!: () => void;
    let entered!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        entered();
        await wait;
        return new Response(null, { status: 200 });
      }),
    );
    const pending = changePrivatePersonPhoto(f.pg.connect(), { actor: f.actor, file: f.file });
    await started;
    try {
      expect(
        await anonymizeDiver(f.pg.db, {
          shopId: f.shop.id,
          personId: f.person.id,
          actorPersonId: f.owner.id,
        }),
      ).toMatchObject({ ok: true });
    } finally {
      release();
    }
    expect(await pending).toBe("invalid");
    const [person] = await f.pg.db.select().from(people).where(eq(people.id, f.person.id));
    const uploads = await f.pg.db.select().from(privatePersonPhotoUploads);
    expect(person?.anonymizedAt).not.toBeNull();
    expect(person?.diverPhotoPath).toBeNull();
    expect(uploads).toHaveLength(2);
    expect(uploads.every((upload) => upload.state === "retired")).toBe(true);
  });

  it("refuses publication when a delivered capability is revoked during the PUT", async () => {
    const f = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        entered();
        await wait;
        return new Response(null, { status: 200 });
      }),
    );
    const pending = changePrivatePersonPhoto(f.pg.connect(), { actor: f.actor, file: f.file });
    await started;
    try {
      await f.pg.db
        .update(bookingCapabilities)
        .set({ revokedAt: nowDate() })
        .where(eq(bookingCapabilities.bookingId, f.booking.id));
    } finally {
      release();
    }
    expect(await pending).toBe("invalid");
    const [person] = await f.pg.db.select().from(people).where(eq(people.id, f.person.id));
    expect(person?.diverPhotoPath).toBeNull();
    const [staged] = await f.pg.db.select().from(privatePersonPhotoUploads);
    expect(staged?.state).toBe("staged");
  });

  it("retries ambiguous PUTs without purging a currently referenced key", async () => {
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    expect(await changePrivatePersonPhoto(f.pg.db, { actor: f.actor, file: f.file })).toBe("saved");
    const [person] = await f.pg.db.select().from(people).where(eq(people.id, f.person.id));
    if (!person?.diverPhotoPath) throw new Error("active picture missing");
    // Even inconsistent bookkeeping must not cause deletion of a referenced object.
    await f.pg.db
      .update(privatePersonPhotoUploads)
      .set({ state: "retired" })
      .where(eq(privatePersonPhotoUploads.url, person.diverPhotoPath));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("lost response");
      }),
    );
    expect(await changePrivatePersonPhoto(f.pg.db, { actor: f.actor, file: f.file })).toBe(
      "failed",
    );
    const all = await f.pg.db.select().from(privatePersonPhotoUploads);
    const orphan = all.find((row) => row.url !== person.diverPhotoPath);
    if (!orphan) throw new Error("missing durable upload intent");
    await f.pg.db
      .update(privatePersonPhotoUploads)
      .set({ createdAt: new Date(nowDate().getTime() - 7200000) })
      .where(eq(privatePersonPhotoUploads.url, orphan.url));
    await expect(cleanupPrivatePersonPhotos(f.pg.db)).rejects.toThrow(
      "private_photo_cleanup_failed",
    );
    const after = await f.pg.db.select().from(privatePersonPhotoUploads);
    expect(after.find((row) => row.url === orphan.url)?.state).toBe("retired");
    expect(after.find((row) => row.url === person.diverPhotoPath)).toMatchObject({
      lastCleanupError: "private_photo_still_referenced",
    });
    const firstAttemptCount = requests.length;
    expect(firstAttemptCount).toBeGreaterThan(0);
    await cleanupPrivatePersonPhotos(f.pg.db);
    expect(requests).toHaveLength(firstAttemptCount);
    await f.pg.db
      .update(privatePersonPhotoUploads)
      .set({ lastCleanupAt: new Date(nowDate().getTime() - 172800000) })
      .where(eq(privatePersonPhotoUploads.url, orphan.url));
    await cleanupPrivatePersonPhotos(f.pg.db);
    expect(requests.length).toBeGreaterThan(firstAttemptCount);
    const [still] = await f.pg.db.select().from(people).where(eq(people.id, f.person.id));
    expect(still?.diverPhotoPath).toBe(person.diverPhotoPath);
  });

  it("defers held keys and bounds each cleanup pass to five", async () => {
    const f = await fixture();
    const url = (i: number) =>
      `https://test-photo-bucket.s3.us-east-1.amazonaws.com/private-person-photos/${String(i).padStart(22, "A")}.jpg`;
    await f.pg.db
      .update(people)
      .set({ diverPhotoPath: url(0) })
      .where(eq(people.id, f.person.id));
    await f.pg.db
      .insert(privatePersonPhotoUploads)
      .values({ url: url(0), shopId: f.shop.id, personId: f.person.id, state: "retired" });
    await expect(cleanupPrivatePersonPhotos(f.pg.db)).rejects.toThrow(
      "private_photo_cleanup_failed",
    );
    expect(requests).toHaveLength(0);
    const [held] = await f.pg.db.select().from(privatePersonPhotoUploads);
    expect(held).toMatchObject({ lastCleanupError: "private_photo_still_referenced" });
    expect(held?.lastCleanupAt).not.toBeNull();
    await f.pg.db.insert(privatePersonPhotoUploads).values(
      Array.from({ length: 7 }, (_, index) => ({
        url: url(index + 1),
        shopId: f.shop.id,
        personId: f.person.id,
        state: "retired" as const,
      })),
    );
    expect(await cleanupPrivatePersonPhotos(f.pg.db, 100)).toEqual({ attempted: 5 });
    const afterFirst = await f.pg.db.select().from(privatePersonPhotoUploads);
    expect(afterFirst.filter((row) => row.url !== url(0) && row.lastCleanupAt)).toHaveLength(5);
    expect(await cleanupPrivatePersonPhotos(f.pg.db, 100)).toEqual({ attempted: 2 });
    expect(await cleanupPrivatePersonPhotos(f.pg.db, 100)).toEqual({ attempted: 0 });
    const [person] = await f.pg.db.select().from(people).where(eq(people.id, f.person.id));
    expect(person?.diverPhotoPath).toBe(url(0));
  });
});
