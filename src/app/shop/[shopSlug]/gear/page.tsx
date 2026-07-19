import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
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
  updateGearItem,
} from "@/db/gear";
import { getShopById } from "@/db/queries";
import { formatShortDate } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";

const itemSchema = z.object({
  label: z.string().trim().min(2).max(80),
  type: z.enum(["bcd", "regulator", "wetsuit", "mask_fins", "weights", "tank"]),
  size: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
  serviceDueOn: z.string().optional(),
});

const serviceSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().min(3).max(500),
  completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nextDueOn: z.string().optional(),
});

const GEAR_TYPES = {
  bcd: "BCD",
  regulator: "Regulator",
  wetsuit: "Wetsuit",
  mask_fins: "Mask & fins",
  weights: "Weights",
  tank: "Tank",
} as const;

/** Store calendar-only service dates at midday UTC so every US shop sees the selected day. */
function calendarDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default async function GearPage({
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
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
  const availableCount = items.filter((item) => item.state === "available").length;
  const holdCount = items.filter((item) => item.state === "service_hold").length;
  const assignedCount = items.filter((item) => item.state === "assigned").length;
  const retiredCount = items.filter((item) => item.state === "retired").length;

  async function addAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = itemSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`/shop/${staff.user.shopSlug}/gear?notice=invalid`);
    const serviceDueAt = calendarDate(parsed.data.serviceDueOn);
    if (parsed.data.serviceDueOn && !serviceDueAt)
      redirect(`/shop/${staff.user.shopSlug}/gear?notice=invalid`);
    await createGearItem(await getDb(), {
      shopId: staff.user.shopId,
      label: parsed.data.label,
      type: parsed.data.type,
      size: parsed.data.size,
      serviceDueAt: serviceDueAt ?? undefined,
      notes: parsed.data.notes,
    });
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/gear`,
      `/shop/${staff.user.shopSlug}/gear?notice=added`,
    );
  }
  async function updateAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = itemSchema.safeParse(Object.fromEntries(formData));
    const id = String(formData.get("id") ?? "");
    if (!id || !parsed.success) redirect(`/shop/${staff.user.shopSlug}/gear?notice=invalid`);
    const serviceDueAt = calendarDate(parsed.data.serviceDueOn);
    if (parsed.data.serviceDueOn && !serviceDueAt)
      redirect(`/shop/${staff.user.shopSlug}/gear?notice=invalid`);
    const updated = await updateGearItem(await getDb(), staff.user.shopId, id, {
      label: parsed.data.label,
      type: parsed.data.type,
      size: parsed.data.size,
      serviceDueAt: serviceDueAt ?? undefined,
      notes: parsed.data.notes,
    });
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/gear`,
      `/shop/${staff.user.shopSlug}/gear?notice=${updated ? "saved" : "invalid"}`,
    );
  }
  async function holdAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const id = String(formData.get("id") ?? "");
    const held = formData.get("held") === "true";
    await setGearServiceHold(await getDb(), staff.user.shopId, id, held);
    revalidateAndRedirect(`/shop/${staff.user.shopSlug}/gear`);
  }
  async function returnAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    await returnGear(await getDb(), staff.user.shopId, String(formData.get("id") ?? ""));
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/gear`,
      `/shop/${staff.user.shopSlug}/gear?notice=returned`,
    );
  }
  async function retireAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const retired = await retireGear(
      await getDb(),
      staff.user.shopId,
      String(formData.get("id") ?? ""),
    );
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/gear`,
      `/shop/${staff.user.shopSlug}/gear?notice=${retired ? "retired" : "invalid"}`,
    );
  }
  async function serviceAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = serviceSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`/shop/${staff.user.shopSlug}/gear?notice=invalid`);
    const serviceCompletedAt = calendarDate(parsed.data.completedOn);
    const nextServiceDueAt = calendarDate(parsed.data.nextDueOn);
    if (!serviceCompletedAt || (parsed.data.nextDueOn && !nextServiceDueAt)) {
      redirect(`/shop/${staff.user.shopSlug}/gear?notice=invalid`);
    }
    const outcome = await recordGearService(await getDb(), {
      shopId: staff.user.shopId,
      gearItemId: parsed.data.id,
      recordedByPersonId: staff.user.personId,
      note: parsed.data.note,
      serviceCompletedAt,
      nextServiceDueAt,
    });
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/gear`,
      `/shop/${staff.user.shopSlug}/gear?notice=${outcome.ok ? "service" : "service-error"}`,
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={shop.name}
        title="Gear room"
        description="Keep equipment ready, traceable, and easy to pack. Service holds cannot be assigned; checked-out gear stays visible until it returns."
        actions={
          <a
            href="#add-gear"
            className="min-h-11 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
          >
            <span aria-hidden="true">+</span> Add gear
          </a>
        }
      />
      <section aria-label="Gear snapshot" className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ShopStat label="Available" value={availableCount} detail="Ready to pack" tone="success" />
        <ShopStat
          label="Checked out"
          value={assignedCount}
          detail="Currently with divers"
          tone="primary"
        />
        <ShopStat
          label="Service hold"
          value={holdCount}
          detail="Unavailable until checked"
          tone={holdCount > 0 ? "warning" : "default"}
        />
        <ShopStat label="Retired" value={retiredCount} detail="Kept for inventory history" />
      </section>
      {notice ? (
        <ShopNotice
          tone={notice === "invalid" || notice === "service-error" ? "danger" : "success"}
        >
          {notice === "added"
            ? "Gear added to inventory."
            : notice === "returned"
              ? "Gear returned to inventory."
              : notice === "service"
                ? "Service recorded and gear returned to the packing pool."
                : notice === "retired"
                  ? "Gear retired from inventory."
                  : notice === "saved"
                    ? "Gear details updated."
                    : "Check the gear details and try again."}
        </ShopNotice>
      ) : null}
      <details
        id="add-gear"
        className="mt-8 scroll-mt-24 rounded-2xl border border-border bg-surface p-5 shadow-sm"
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-semibold [&::-webkit-details-marker]:hidden">
          Add inventory item{" "}
          <span aria-hidden="true" className="text-xl font-normal text-primary">
            +
          </span>
        </summary>
        <form action={addAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Inventory label
            <input
              name="label"
              required
              placeholder="BCD-12"
              className="min-h-11 rounded-xl border border-border-strong bg-surface px-3 text-base font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Type
            <select
              name="type"
              className="min-h-11 rounded-xl border border-border-strong bg-surface px-3 text-base font-normal"
            >
              {Object.entries(GEAR_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Size <span className="font-normal text-muted">(optional)</span>
            <input
              name="size"
              placeholder="Medium / 10 / 80 cu ft"
              className="min-h-11 rounded-xl border border-border-strong bg-surface px-3 text-base font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Next service due <span className="font-normal text-muted">(optional)</span>
            <input
              name="serviceDueOn"
              type="date"
              className="min-h-11 rounded-xl border border-border-strong bg-surface px-3 text-base font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
            Notes <span className="font-normal text-muted">(optional)</span>
            <textarea
              name="notes"
              rows={2}
              placeholder="Serial number, fit notes, or storage location"
              className="rounded-xl border border-border-strong bg-surface px-3 py-2 text-base font-normal"
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground sm:justify-self-start"
          >
            Add inventory item
          </button>
        </form>
      </details>
      <section className="mt-10">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Inventory</h2>
            <p className="mt-1 text-sm text-muted">
              Edit ready or held items; retire gear when it leaves the shop.
            </p>
          </div>
          <span className="text-sm text-muted">{items.length} total</span>
        </div>
        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="min-w-0 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5"
            >
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <strong className="block break-words">{item.label}</strong>
                  <span className="mt-1 block text-sm text-muted">
                    {GEAR_TYPES[item.type]}
                    {item.size ? ` · ${item.size}` : ""}
                    {item.serviceDueAt
                      ? ` · service due ${formatShortDate(item.serviceDueAt, "en-US", shop.timezone)}`
                      : ""}
                  </span>
                </div>
                <div className="relative flex min-w-0 flex-wrap items-center gap-1 sm:shrink-0 sm:justify-end">
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-medium ${item.state === "available" ? "bg-success/10 text-success" : item.state === "service_hold" ? "bg-warning/10 text-warning" : item.state === "retired" ? "bg-surface-sunken text-muted" : "bg-primary/10 text-primary"}`}
                  >
                    {item.state.replace("_", " ")}
                  </span>
                  {item.state !== "assigned" && item.state !== "retired" ? (
                    <>
                      <details className="relative">
                        <summary className="flex min-h-11 cursor-pointer items-center rounded-xl border border-border px-3 py-2 text-sm font-medium text-primary">
                          Edit
                        </summary>
                        <form
                          action={updateAction}
                          className="mt-2 grid w-full gap-3 rounded-2xl border border-border bg-surface p-4 shadow-xl sm:absolute sm:right-0 sm:z-10 sm:w-80"
                        >
                          <input type="hidden" name="id" value={item.id} />
                          <label className="flex flex-col gap-1 text-sm font-medium">
                            Label
                            <input
                              name="label"
                              required
                              defaultValue={item.label}
                              className="min-h-11 rounded-xl border border-border-strong bg-surface px-3 text-base"
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-sm font-medium">
                            Type
                            <select
                              name="type"
                              defaultValue={item.type}
                              className="min-h-11 rounded-xl border border-border-strong bg-surface px-3 text-base"
                            >
                              {["bcd", "regulator", "wetsuit", "mask_fins", "weights", "tank"].map(
                                (type) => (
                                  <option key={type} value={type}>
                                    {GEAR_TYPES[type as keyof typeof GEAR_TYPES]}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 text-sm font-medium">
                            Size
                            <input
                              name="size"
                              defaultValue={item.size ?? ""}
                              className="min-h-11 rounded-xl border border-border-strong bg-surface px-3 text-base"
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-sm font-medium">
                            Service due
                            <input
                              name="serviceDueOn"
                              type="date"
                              defaultValue={item.serviceDueAt?.toISOString().slice(0, 10)}
                              className="min-h-11 rounded-xl border border-border-strong bg-surface px-3 text-base"
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-sm font-medium">
                            Notes
                            <textarea
                              name="notes"
                              rows={2}
                              defaultValue={item.notes ?? ""}
                              className="rounded-xl border border-border-strong bg-surface px-3 py-2 text-base"
                            />
                          </label>
                          <button
                            type="submit"
                            className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                          >
                            Save gear
                          </button>
                        </form>
                      </details>
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
                      <details>
                        <summary className="flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10">
                          Retire
                        </summary>
                        <div className="absolute right-0 z-10 mt-2 w-64 rounded-2xl border border-danger/25 bg-surface p-4 text-sm shadow-xl">
                          <p className="text-muted">
                            Retired gear stays in history and can no longer be packed.
                          </p>
                          <form action={retireAction}>
                            <input type="hidden" name="id" value={item.id} />
                            <button
                              type="submit"
                              className="mt-3 min-h-11 rounded-xl bg-danger px-3 py-2 text-sm font-medium text-primary-foreground"
                            >
                              Retire item
                            </button>
                          </form>
                        </div>
                      </details>
                    </>
                  ) : null}
                </div>
              </div>
              {item.state !== "assigned" && item.state !== "retired" ? (
                <details className="mt-3 rounded-lg bg-surface-sunken px-3 py-2 text-sm">
                  <summary className="flex min-h-11 cursor-pointer items-center py-2 font-medium text-primary">
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
