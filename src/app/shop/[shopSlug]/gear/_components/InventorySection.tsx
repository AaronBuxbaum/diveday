import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { formatShortDate } from "@/lib/format";
import { holdAction, retireAction, serviceAction, updateAction } from "../actions";
import { GEAR_TYPES, type GearItem, type Shop } from "./types";

function stateClass(state: GearItem["state"]) {
  if (state === "available") return "bg-success/10 text-success";
  if (state === "service_hold") return "bg-warning/10 text-warning";
  if (state === "retired") return "bg-surface-sunken text-muted";
  return "bg-primary/10 text-primary";
}

function EditGearMenu({ item }: { item: GearItem }) {
  return (
    <details className="relative">
      <summary className="flex min-h-11 cursor-pointer items-center rounded-xl border border-border px-3 py-2 text-sm font-medium text-primary">
        Edit
      </summary>
      <FieldGrid
        columns={1}
        as="form"
        action={updateAction}
        className="mt-2 w-full gap-y-3 rounded-2xl border border-border bg-surface p-4 shadow-xl sm:absolute sm:right-0 sm:z-10 sm:w-80"
      >
        <input type="hidden" name="id" value={item.id} />
        <Field label="Label">
          <input
            name="label"
            required
            defaultValue={item.label}
            className={`${controlClass} rounded-xl`}
          />
        </Field>
        <Field label="Type">
          <select name="type" defaultValue={item.type} className={`${controlClass} rounded-xl`}>
            {Object.entries(GEAR_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Size">
          <input
            name="size"
            defaultValue={item.size ?? ""}
            className={`${controlClass} rounded-xl`}
          />
        </Field>
        <Field label="Service due">
          <input
            name="serviceDueOn"
            type="date"
            defaultValue={item.serviceDueAt?.toISOString().slice(0, 10)}
            className={`${controlClass} rounded-xl`}
          />
        </Field>
        <Field label="Notes">
          <textarea
            name="notes"
            rows={2}
            defaultValue={item.notes ?? ""}
            className={`${controlClass} rounded-xl`}
          />
        </Field>
        <FieldActions>
          <SubmitButton
            pendingLabel="Saving…"
            className={buttonClass({ className: "rounded-xl py-2" })}
          >
            Save gear
          </SubmitButton>
        </FieldActions>
      </FieldGrid>
    </details>
  );
}

function RecordServiceForm({ item }: { item: GearItem }) {
  return (
    <details className="mt-3 rounded-lg bg-surface-sunken px-3 py-2 text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center py-2 font-medium text-primary">
        Record completed service
      </summary>
      <FieldGrid columns={3} as="form" action={serviceAction} className="gap-y-3 pb-2 pt-1">
        <input type="hidden" name="id" value={item.id} />
        <Field label="Completed">
          <input
            name="completedOn"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            className={controlClass}
          />
        </Field>
        <Field label="Next due" hint="(optional)">
          <input name="nextDueOn" type="date" className={controlClass} />
        </Field>
        <Field label="Work completed" className="sm:col-span-3">
          <textarea
            name="note"
            required
            minLength={3}
            maxLength={500}
            rows={2}
            placeholder="Bench-tested regulator; replaced mouthpiece."
            className={controlClass}
          />
        </Field>
        <FieldActions>
          <SubmitButton
            pendingLabel="Logging…"
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            Log service & release
          </SubmitButton>
        </FieldActions>
      </FieldGrid>
    </details>
  );
}

function GearCard({ item, shop }: { item: GearItem; shop: Shop }) {
  const editable = item.state !== "assigned" && item.state !== "retired";
  return (
    <li className="min-w-0 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
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
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${stateClass(item.state)}`}>
            {item.state.replace("_", " ")}
          </span>
          {editable ? (
            <>
              <EditGearMenu item={item} />
              <form action={holdAction}>
                <input type="hidden" name="id" value={item.id} />
                <input
                  type="hidden"
                  name="held"
                  value={item.state !== "service_hold" ? "true" : "false"}
                />
                <SubmitButton
                  pendingLabel="Updating…"
                  className={buttonClass({ variant: "link", size: "sm" })}
                >
                  {item.state === "service_hold" ? "Release hold" : "Service hold"}
                </SubmitButton>
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
                    <SubmitButton
                      pendingLabel="Retiring…"
                      className={buttonClass({
                        variant: "danger-solid",
                        size: "sm",
                        className: "mt-3 rounded-xl",
                      })}
                    >
                      Retire item
                    </SubmitButton>
                  </form>
                </div>
              </details>
            </>
          ) : null}
        </div>
      </div>
      {editable ? <RecordServiceForm item={item} /> : null}
    </li>
  );
}

export function InventorySection({ items, shop }: { items: GearItem[]; shop: Shop }) {
  return (
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
          <GearCard key={item.id} item={item} shop={shop} />
        ))}
      </ul>
    </section>
  );
}
