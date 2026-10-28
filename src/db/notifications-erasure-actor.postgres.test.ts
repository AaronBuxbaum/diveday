import { eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { auth } = await import("@/lib/auth");

import type { Notification, NotificationProvider } from "@/lib/notifications";
import { currentSendActor, type SendActor, withSendActor } from "@/lib/notifications/send-actor";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { createBooking } from "./bookings";
import { withErasureCoordinatedBookingSend } from "./erasure-coordinated-send";
import { sendNotification } from "./notifications";
import { bookings, shops } from "./schema";
import { createTrip } from "./trips";

beforeEach(() => vi.mocked(auth).mockReset());

async function setup() {
  const pg = await postgresTestDb();
  const [shop] = await pg.db
    .insert(shops)
    .values({ name: "Actor Fence", slug: "actor-fence", timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop missing");
  const trip = await createTrip(pg.db, {
    shopId: shop.id,
    title: "Actor fence trip",
    startsAt: new Date("2035-03-12T12:00:00Z"),
    endsAt: new Date("2035-03-12T16:00:00Z"),
    capacity: 4,
    plannedDives: 1,
  });
  if (!trip) throw new Error("trip missing");
  const booking = await createBooking(pg.db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Actor Diver",
    email: "actor-diver@example.com",
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  const [seat] = await pg.db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, booking.bookingId))
    .limit(1);
  if (!seat) throw new Error("booking person missing");
  return { pg, shop, trip, booking, personId: seat.personId };
}

function held(shopId: string): Notification {
  return {
    kind: "seat_already_held",
    heldBookingId: "00000000-0000-4000-8000-0000000000b1",
    shopId,
    to: "actor-diver@example.com",
    locale: "en-US",
    diverName: "Actor Diver",
    shopName: "Actor Fence",
    tripTitle: "Actor fence trip",
    startsAt: new Date("2035-03-12T12:00:00Z"),
    timezone: "UTC",
    requestedAt: new Date("2035-03-01T00:00:00Z"),
    attempt: "claim",
  };
}

describePostgres("send actor context across erasure fences", () => {
  it("keeps staff attribution through nested fences and a real provider send", async () => {
    const { pg, shop, trip, booking, personId } = await setup();
    const actor: SendActor = { personId, shopId: shop.id };
    let sentBy: string | undefined;
    const provider: NotificationProvider = {
      async send(notification) {
        sentBy = notification.sender?.sentByPersonId;
        return { status: "sent", providerMessageId: "actor-context" };
      },
    };

    vi.mocked(auth).mockResolvedValue({
      user: { personId, shopId: shop.id, roles: ["owner"] },
    } as never);
    const result = await withErasureCoordinatedBookingSend(
      pg.db,
      {
        shopId: shop.id,
        bookingId: booking.bookingId,
        expectedPersonId: personId,
        expectedTripId: trip.id,
      },
      (tx) =>
        withErasureCoordinatedBookingSend(
          tx,
          {
            shopId: shop.id,
            bookingId: booking.bookingId,
            expectedPersonId: personId,
            expectedTripId: trip.id,
          },
          (nestedTx) => sendNotification(nestedTx, held(shop.id), provider),
        ),
    );

    expect(result).toMatchObject({ status: "sent" });
    expect(sentBy).toBe(actor.personId);
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it("keeps an explicit public/system null actor from reading auth inside the transaction", async () => {
    const { pg, shop, trip, booking, personId } = await setup();
    vi.mocked(auth).mockResolvedValue({
      user: { personId, shopId: shop.id, roles: ["owner"] },
    } as never);
    let sentBy: string | undefined;
    const provider: NotificationProvider = {
      async send(notification) {
        sentBy = notification.sender?.sentByPersonId;
        return { status: "sent", providerMessageId: "system-context" };
      },
    };

    const result = await withSendActor(null, () =>
      withErasureCoordinatedBookingSend(
        pg.db,
        {
          shopId: shop.id,
          bookingId: booking.bookingId,
          expectedPersonId: personId,
          expectedTripId: trip.id,
        },
        (tx) => sendNotification(tx, held(shop.id), provider),
      ),
    );

    expect(result).toMatchObject({ status: "sent" });
    expect(sentBy).toBeUndefined();
    expect(auth).not.toHaveBeenCalled();
  });

  it("isolates simultaneous request actors and restores the outer context", async () => {
    const first: SendActor = {
      personId: "00000000-0000-4000-8000-000000000101",
      shopId: "00000000-0000-4000-8000-000000000201",
    };
    const second: SendActor = {
      personId: "00000000-0000-4000-8000-000000000102",
      shopId: "00000000-0000-4000-8000-000000000202",
    };
    const [firstSeen, secondSeen] = await Promise.all([
      withSendActor(first, async () => {
        await Promise.resolve();
        return currentSendActor();
      }),
      withSendActor(second, async () => {
        await Promise.resolve();
        return currentSendActor();
      }),
    ]);
    expect(firstSeen).toEqual(first);
    expect(secondSeen).toEqual(second);
    expect(await currentSendActor()).toBeNull();
  });
});
