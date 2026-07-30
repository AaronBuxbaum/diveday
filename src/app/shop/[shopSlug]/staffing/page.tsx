import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getStaffingView } from "@/db/staffing";
import { listStaff } from "@/db/trips";
import {
  calendarDateInTimezone,
  formatCalendarDate,
  isValidCalendarDate,
} from "@/lib/calendar-date";
import { formatTimeRangeTz } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { parseWallTime, toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { createShiftAction, deleteShiftAction } from "./actions";

export const metadata: Metadata = { title: "Staffing — DiveDay" };

const notices: Record<string, { tone: "success" | "danger" | "warning"; text: string }> = {
  "shift-saved": { tone: "success", text: "Shift saved." },
  "shift-deleted": { tone: "success", text: "Shift removed." },
  overlap: { tone: "danger", text: "That person already has an overlapping shift." },
  staff_not_found: { tone: "danger", text: "That staff member is no longer on this shop's team." },
  invalid: { tone: "danger", text: "Check the shift date and times, then try again." },
  "not-authorized": { tone: "danger", text: "Only owners and managers can change shifts." },
};

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function StaffingPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ from?: string; to?: string; notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const query = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(`/shop/${shopSlug}`);
  const today = calendarDateInTimezone(new Date(), shop.timezone);
  const fromValue = query.from && isValidCalendarDate(query.from) ? query.from : today;
  const toValue = query.to && isValidCalendarDate(query.to) ? query.to : addDays(fromValue, 6);
  const fromWall = parseWallTime(fromValue, "00:00");
  const toWall = parseWallTime(addDays(toValue, 1), "00:00");
  if (!fromWall || !toWall) redirect(`/shop/${shopSlug}/staffing`);
  const view = await getStaffingView(
    db,
    shop.id,
    wallTimeToUtc(fromWall, shop.timezone),
    wallTimeToUtc(toWall, shop.timezone),
  );
  const staff = await listStaff(db, shop.id);
  const canManage = await canPersonManageStaffAccounts(db, shop.id, session.user.personId);
  const notice = query.notice ? notices[query.notice] : undefined;
  const defaultStart = utcToWallTime(view.from, shop.timezone);
  const defaultDate = toDateInputValue(defaultStart);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["from", "to", "notice"]} />
      <ShopPageHeader
        eyebrow="Operations"
        title="Staffing"
        description="See who is working, what each person is qualified to teach or crew, and where the next boat still has a coverage gap."
      />

      {notice ? (
        <div className="mt-6">
          <ShopNotice tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>
            {notice.text}
          </ShopNotice>
        </div>
      ) : null}

      <section className="mt-8 rounded-2xl border border-border bg-surface p-5">
        <FieldGrid as="form" columns={3} method="get">
          <Field label="From">
            <input name="from" type="date" defaultValue={fromValue} className={controlClass} />
          </Field>
          <Field label="Through">
            <input name="to" type="date" defaultValue={toValue} className={controlClass} />
          </Field>
          <FieldActions>
            <button type="submit" className={buttonClass({ variant: "secondary" })}>
              Show window
            </button>
          </FieldActions>
        </FieldGrid>
      </section>

      <section className="mt-8" aria-labelledby="working-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="working-heading" className="text-xl font-semibold">
              Who is working
            </h2>
            <p className="mt-1 text-sm text-muted">
              {formatCalendarDate(fromValue, shop.defaultLocale)} –{" "}
              {formatCalendarDate(toValue, shop.defaultLocale)}
            </p>
          </div>
          {canManage ? <Badge tone="neutral">Shift changes require owner or manager</Badge> : null}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {view.staff.map((member) => (
            <article
              key={member.person.id}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{member.person.fullName}</h3>
                  <p className="mt-1 text-sm text-muted">{member.roles.join(" · ")}</p>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {member.capabilities.map((capability) => (
                    <Badge key={capability} tone="primary">
                      {capability === "teach"
                        ? "Can teach"
                        : capability === "captain"
                          ? "Captain"
                          : "Can crew"}
                    </Badge>
                  ))}
                </div>
              </div>
              {member.shifts.length === 0 ? (
                <p className="mt-4 text-sm text-warning">Not scheduled in this window.</p>
              ) : (
                <ul className="mt-4 space-y-2 text-sm">
                  {member.shifts.map((shift) => (
                    <li
                      key={shift.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2"
                    >
                      <span>
                        <span className="font-medium">
                          {formatTimeRangeTz(
                            shift.startsAt,
                            shift.endsAt,
                            shop.defaultLocale,
                            shop.timezone,
                          )}
                        </span>
                        {shift.note ? <span className="ml-2 text-muted">{shift.note}</span> : null}
                      </span>
                      {canManage ? (
                        <form action={deleteShiftAction}>
                          <input type="hidden" name="shiftId" value={shift.id} />
                          <SubmitButton
                            pendingLabel="Removing…"
                            className={buttonClass({ variant: "ghost", size: "sm" })}
                          >
                            Remove
                          </SubmitButton>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>

      {canManage ? (
        <section
          className="mt-8 rounded-2xl border border-border bg-surface p-5"
          aria-labelledby="add-shift-heading"
        >
          <h2 id="add-shift-heading" className="text-lg font-semibold">
            Add a working shift
          </h2>
          <p className="mt-1 text-sm text-muted">
            A shift says when someone is available. Assign the actual crew on each trip separately.
          </p>
          <FieldGrid as="form" action={createShiftAction} columns={2} className="mt-4">
            <Field label="Staff member">
              <select name="personId" required className={controlClass}>
                <option value="">Choose a person</option>
                {staff.map((member) => (
                  <option key={member.person.id} value={member.person.id}>
                    {member.person.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <input
                name="date"
                type="date"
                required
                defaultValue={defaultDate}
                className={controlClass}
              />
            </Field>
            <Field label="Starts">
              <input
                name="startTime"
                type="time"
                required
                defaultValue="07:00"
                className={controlClass}
              />
            </Field>
            <Field label="Ends">
              <input
                name="endTime"
                type="time"
                required
                defaultValue="15:00"
                className={controlClass}
              />
            </Field>
            <Field label="Note" hint="Optional">
              <input
                name="note"
                maxLength={120}
                className={controlClass}
                placeholder="Dock, classroom, boat 2"
              />
            </Field>
            <FieldActions>
              <SubmitButton pendingLabel="Saving…" className={buttonClass()}>
                Add shift
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </section>
      ) : null}

      <section className="mt-10" aria-labelledby="coverage-heading">
        <h2 id="coverage-heading" className="text-xl font-semibold">
          Coverage gaps
        </h2>
        <p className="mt-1 text-sm text-muted">
          These are prompts to resolve before the manifest becomes a dock-side surprise.
        </p>
        <div className="mt-4 grid gap-3">
          {view.trips.length === 0 ? (
            <p className="text-sm text-muted">No scheduled trips in this window.</p>
          ) : null}
          {view.trips.map((entry) => (
            <article key={entry.trip.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{entry.trip.title}</h3>
                  <p className="mt-1 text-sm text-muted">
                    {formatTimeRangeTz(
                      entry.trip.startsAt,
                      entry.trip.endsAt,
                      shop.defaultLocale,
                      shop.timezone,
                    )}
                    {entry.courseTitle ? ` · ${entry.courseTitle}` : ""}
                  </p>
                </div>
                <Badge tone={entry.gaps.length === 0 ? "success" : "warning"}>
                  {entry.gaps.length === 0
                    ? "Covered"
                    : `${entry.gaps.length} gap${entry.gaps.length === 1 ? "" : "s"}`}
                </Badge>
              </div>
              {entry.gaps.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-warning">
                  {entry.gaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-success">
                  Crew is assigned, and their shift covers this trip.
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
