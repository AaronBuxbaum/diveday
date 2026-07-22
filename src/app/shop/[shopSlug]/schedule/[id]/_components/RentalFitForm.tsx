import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { formatMoneyCents } from "@/lib/format";
import {
  hasAnyRentalPricing,
  offeredRentableItems,
  quoteRentalFit,
  type RentalPricing,
} from "@/lib/rentals";
import type { RentalFit } from "./types";

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

/**
 * The diver's rental-fit capture, reused by the booking confirmation and the
 * `/ready` page. The submit target is passed in as `action` so each surface
 * binds its own (page-scoped or token-scoped) server action. `rentalItems` is
 * the shop's catalog: a diver is only offered gear the shop actually rents, and
 * a size field only appears for an item on offer. `pricing` is the shop's price
 * list; when a shop prices nothing the form keeps the "ask the shop" behaviour.
 */
export function RentalFitForm({
  action,
  rentalFit,
  rentalItems,
  pricing,
  wantsNitrox,
  nitroxCardVerified,
  plannedDives,
  saved,
}: {
  action: (formData: FormData) => void;
  rentalFit: RentalFit;
  rentalItems: string[];
  pricing: RentalPricing;
  wantsNitrox: boolean;
  nitroxCardVerified: boolean;
  plannedDives: number;
  saved: boolean;
}) {
  const offered = offeredRentableItems(rentalItems);
  const offers = new Set(offered.map((item) => item.kind));
  const showPricing = hasAnyRentalPricing(pricing);
  // A quote for what the diver currently has on file (defaults when no fit yet).
  // It reflects saved state, not live checkbox toggles, so it settles after a
  // save rather than pretending to be a running calculator.
  const quote = quoteRentalFit(pricing, {
    rentedKinds: offered
      .filter((item) => rentalFit?.[item.field] ?? item.defaultRented)
      .map((item) => item.kind),
    wantsNitrox,
    plannedDives,
  });
  return (
    <section className="mt-5 rounded-lg border border-border bg-surface/70 p-4 text-left">
      <h3 className="font-medium">Rental fit</h3>
      <p className="mt-1 text-sm text-muted">
        Tell the crew what you’d like to rent and roughly what size. We keep it on file for next
        time, and they’ll confirm fit and weighting with you at the dock.
      </p>
      {saved ? (
        <p
          role="status"
          className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success"
        >
          Saved. The crew will see this when they pack, and check the fit with you at the dock.
        </p>
      ) : null}
      <form action={action} className="mt-4 flex flex-col gap-4">
        {offered.length > 0 ? (
          <fieldset>
            <legend className="text-sm font-medium">What should we plan to have ready?</legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {offered.map(({ kind, name, field, label, defaultRented }) => {
                const priceCents = pricing.perItemCents[kind];
                return (
                  <label
                    key={name}
                    className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"
                  >
                    <input
                      name={name}
                      type="checkbox"
                      defaultChecked={rentalFit?.[field] ?? defaultRented}
                      className="size-4 accent-primary"
                    />
                    <span className="flex-1">{label}</span>
                    {showPricing && priceCents !== undefined ? (
                      <span className="text-muted">{formatMoneyCents(priceCents)}</span>
                    ) : null}
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-muted">
              We plan one tank per dive, so {plannedDives} {plannedDives === 1 ? "tank" : "tanks"}{" "}
              for this trip.{" "}
              {showPricing
                ? pricing.setCents !== null
                  ? `Take the full set for ${formatMoneyCents(pricing.setCents)}, or pick pieces above.`
                  : "Prices are per piece."
                : "Ask the shop what’s included in the trip price."}
            </p>
            {showPricing && quote.subtotalCents > 0 ? (
              <p className="mt-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                <span className="font-medium">
                  Estimated rental: {formatMoneyCents(quote.subtotalCents)} per person
                </span>
                {quote.unpricedKinds.length > 0 ? " — plus a few items settled at the shop" : ""}.
                We’ll confirm at the dock.
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <fieldset>
          <legend className="text-sm font-medium">Enriched air (nitrox)</legend>
          <label className="mt-2 flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm">
            <input
              name="nitrox"
              type="checkbox"
              defaultChecked={wantsNitrox}
              className="size-4 accent-primary"
            />
            <span className="flex-1">
              Fill my tanks with nitrox —{" "}
              {showPricing && pricing.nitroxCents !== null
                ? `${formatMoneyCents(pricing.nitroxCents)} per dive`
                : "charged per dive"}
            </span>
          </label>
          {nitroxCardVerified ? (
            <p className="mt-2 text-sm text-muted">
              You’ll analyze your own tanks and sign for the mix at the fill station, as always.
            </p>
          ) : (
            <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
              {wantsNitrox ? "Your enriched-air request is on file. " : ""}
              We need a verified nitrox card before we can fill a nitrox tank — send the shop a
              photo of your card or get in touch and they’ll add it. Until then your tanks are
              filled with air.
            </p>
          )}
        </fieldset>

        {offers.has("bcd") || offers.has("wetsuit") || offers.has("mask_fins") ? (
          <FieldGrid columns={2}>
            {offers.has("bcd") ? (
              <Field label="BCD size">
                <select
                  name="bcdSize"
                  defaultValue={rentalFit?.bcdSize ?? ""}
                  className={controlClass}
                >
                  <option value="">Not sure — help me fit it</option>
                  {SIZES.map((size) => (
                    <option key={size}>{size}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            {offers.has("wetsuit") ? (
              <Field label="Wetsuit size">
                <select
                  name="wetsuitSize"
                  defaultValue={rentalFit?.wetsuitSize ?? ""}
                  className={controlClass}
                >
                  <option value="">Not sure — help me fit it</option>
                  {SIZES.map((size) => (
                    <option key={size}>{size}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            {offers.has("wetsuit") ? (
              <Field label="Boot size" hint="(optional)">
                <input
                  name="bootSize"
                  maxLength={20}
                  defaultValue={rentalFit?.bootSize ?? ""}
                  placeholder="US 9 / EU 42"
                  className={controlClass}
                />
              </Field>
            ) : null}
            {offers.has("mask_fins") ? (
              <Field label="Fin size" hint="(optional)">
                <input
                  name="finSize"
                  maxLength={20}
                  defaultValue={rentalFit?.finSize ?? ""}
                  placeholder="M/L"
                  className={controlClass}
                />
              </Field>
            ) : null}
          </FieldGrid>
        ) : null}
        <FieldGrid columns={1}>
          {offers.has("weights") ? (
            <Field label="Usual weight setup" hint="(optional)">
              <input
                name="weightPreference"
                maxLength={80}
                defaultValue={rentalFit?.weightPreference ?? ""}
                placeholder="e.g. 16 lb with a 3 mm suit"
                className={controlClass}
              />
            </Field>
          ) : null}
          <Field label="Anything else the crew should know?" hint="(optional)">
            <textarea
              name="note"
              rows={2}
              maxLength={300}
              defaultValue={rentalFit?.note ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div>
          <SubmitButton
            pendingLabel="Saving fit…"
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "px-4 text-foreground",
            })}
          >
            Save rental fit
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
