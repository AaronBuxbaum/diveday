import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { getDb } from "@/db/client";
import {
  createGearItem,
  listCurrentGearAssignments,
  listGearInventory,
  listGearServiceEvents,
  recordGearService,
  retireGear,
  returnGear,
  setGearServiceHold,
} from "@/db/gear";
import { getShopById } from "@/db/queries";
import { formatShortDate } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";

const itemSchema = z.object({
  label: z.string().trim().min(2).max(80),
  type: z.enum(["bcd", "regulator", "wetsuit", "mask_fins", "weights", "tank"]),
  size: z.string().trim().max(40).optional(),
  serviceDueOn: z.string().optional(),
});

const serviceSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().min(3).max(500),
  completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nextDueOn: z.string().optional(),
});

/** Store calendar-only service dates at midday UTC so every US shop sees the selected day. */
function calendarDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default async function GearPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const [items, assignments, serviceEvents] = await Promise.all([
    listGearInventory(db, shop.id),
    listCurrentGearAssignments(db, shop.id),
    listGearServiceEvents(db, shop.id),
  ]);

  async function addAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = itemSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect("/shop/gear?notice=invalid");
    const serviceDueAt = calendarDate(parsed.data.serviceDueOn);
    if (parsed.data.serviceDueOn && !serviceDueAt) redirect("/shop/gear?notice=invalid");
    await createGearItem(await getDb(), {
      shopId: staff.user.shopId,
      label: parsed.data.label,
      type: parsed.data.type,
      size: parsed.data.size,
      serviceDueAt: serviceDueAt ?? undefined,
    });
    redirect("/shop/gear?notice=added");
  }
  async function holdAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const id = String(formData.get("id") ?? "");
    const held = formData.get("held") === "true";
    await setGearServiceHold(await getDb(), staff.user.shopId, id, held);
    redirect("/shop/gear");
  }
  async function returnAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    await returnGear(await getDb(), staff.user.shopId, String(formData.get("id") ?? ""));
    redirect("/shop/gear?notice=returned");
  }
  async function retireAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const retired = await retireGear(
      await getDb(),
      staff.user.shopId,
      String(formData.get("id") ?? ""),
    );
    redirect(`/shop/gear?notice=${retired ? "retired" : "invalid"}`);
  }
  async function serviceAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = serviceSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect("/shop/gear?notice=invalid");
    const serviceCompletedAt = calendarDate(parsed.data.completedOn);
    const nextServiceDueAt = calendarDate(parsed.data.nextDueOn);
    if (!serviceCompletedAt || (parsed.data.nextDueOn && !nextServiceDueAt)) {
      redirect("/shop/gear?notice=invalid");
    }
    const outcome = await recordGearService(await getDb(), {
      shopId: staff.user.shopId,
      gearItemId: parsed.data.id,
      recordedByPersonId: staff.user.personId,
      note: parsed.data.note,
      serviceCompletedAt,
      nextServiceDueAt,
    });
    redirect(`/shop/gear?notice=${outcome.ok ? "service" : "service-error"}`);
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <FlashParams params={["notice"]} />
      <Link href="/shop" className="text-sm font-medium text-primary hover:underline">
        ← Back to the shop
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Gear room</h1>
      <p className="mt-2 text-muted">
        Service holds cannot be assigned. Checked-out gear stays visible until it returns.
      </p>
      {notice ? (
        <p
          role="status"
          className="mt-5 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success"
        >
          {notice === "added"
            ? "Gear added to inventory."
            : notice === "returned"
              ? "Gear returned to inventory."
              : notice === "service"
                ? "Service recorded and gear returned to the packing pool."
                : notice === "retired"
                  ? "Gear retired from inventory."
                  : "Check the gear details and try again."}
        </p>
      ) : null}
      <form
        action={addAction}
        className="mt-8 grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-5 sm:grid-cols-3"
      >
        <input
          name="label"
          required
          placeholder="BCD-12"
          className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base"
        />
        <select
          name="type"
          className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base"
        >
          {["bcd", "regulator", "wetsuit", "mask_fins", "weights", "tank"].map((type) => (
            <option key={type}>{type.replace("_", " ")}</option>
          ))}
        </select>
        <input
          name="size"
          placeholder="Size (optional)"
          className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base"
        />
        <input
          name="serviceDueOn"
          type="date"
          aria-label="Next service due date"
          className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base"
        />
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground sm:col-span-3"
        >
          Add inventory item
        </button>
      </form>
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Inventory</h2>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {items.map((item) => (
            <li key={item.id} className="px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  <strong>{item.label}</strong>{" "}
                  <span className="text-sm text-muted">
                    {item.type.replace("_", " ")}
                    {item.size ? ` · ${item.size}` : ""}
                    {item.serviceDueAt
                      ? ` · service due ${formatShortDate(item.serviceDueAt, "en-US", shop.timezone)}`
                      : ""}
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                    {item.state.replace("_", " ")}
                  </span>
                  {item.state !== "assigned" && item.state !== "retired" ? (
                    <>
                      <form action={holdAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <input
                          type="hidden"
                          name="held"
                          value={item.state !== "service_hold" ? "true" : "false"}
                        />
                        <button
                          type="submit"
                          className="min-h-11 px-3 text-sm font-medium text-primary hover:underline"
                        >
                          {item.state === "service_hold" ? "Release hold" : "Service hold"}
                        </button>
                      </form>
                      <form action={retireAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <button
                          type="submit"
                          className="min-h-11 px-3 text-sm font-medium text-danger hover:underline"
                        >
                          Retire item
                        </button>
                      </form>
                    </>
                  ) : null}
                </div>
              </div>
              {item.state !== "assigned" && item.state !== "retired" ? (
                <details className="mt-3 rounded-lg bg-surface-sunken px-3 py-2 text-sm">
                  <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">
                    Record completed service
                  </summary>
                  <form action={serviceAction} className="grid gap-3 pb-2 pt-1 sm:grid-cols-3">
                    <input type="hidden" name="id" value={item.id} />
                    <label className="flex flex-col gap-1">
                      Completed
                      <input
                        name="completedOn"
                        type="date"
                        required
                        defaultValue={new Date().toISOString().slice(0, 10)}
                        className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      Next due <span className="text-muted">(optional)</span>
                      <input
                        name="nextDueOn"
                        type="date"
                        className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base"
                      />
                    </label>
                    <label className="flex flex-col gap-1 sm:col-span-3">
                      Work completed
                      <textarea
                        name="note"
                        required
                        minLength={3}
                        maxLength={500}
                        rows={2}
                        placeholder="Bench-tested regulator; replaced mouthpiece."
                        className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-base"
                      />
                    </label>
                    <div>
                      <button
                        type="submit"
                        className="min-h-11 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface"
                      >
                        Log service & release
                      </button>
                    </div>
                  </form>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Recent service</h2>
        {serviceEvents.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Completed service will be recorded here.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {serviceEvents.slice(0, 12).map(({ service, item, staff }) => (
              <li key={service.id} className="px-4 py-3 text-sm">
                <p>
                  <strong>{item.label}</strong> · {service.note}
                </p>
                <p className="mt-1 text-muted">
                  {formatShortDate(service.serviceCompletedAt, "en-US", shop.timezone)} by{" "}
                  {staff.fullName}
                  {service.nextServiceDueAt
                    ? ` · next due ${formatShortDate(service.nextServiceDueAt, "en-US", shop.timezone)}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Packing & returns</h2>
        {assignments.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Everything is back in the room.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {assignments.map(({ assignment, item, person, trip }) => (
              <li key={assignment.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span>
                  <strong>{item.label}</strong> · {person.fullName}
                  <span className="block text-sm text-muted">{trip.title}</span>
                </span>
                <form action={returnAction}>
                  <input type="hidden" name="id" value={assignment.id} />
                  <button
                    type="submit"
                    className="min-h-11 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-sunken"
                  >
                    Return gear
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
