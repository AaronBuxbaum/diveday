import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { rentalFitLine } from "@/lib/dive-prep";
import { offeredRentableItems } from "@/lib/rentals";
import { saveProfileAction, setNeedsStaffFitAction } from "../actions";
import type { DiverProfile } from "./shared";

export function RentalFit({
  diver,
  shopSlug,
  personId,
  rentalItems,
  canOverride,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  rentalItems: string[];
  /** Instructor/divemaster/manager may rewrite the diver's stated fit (H-06). */
  canOverride: boolean;
}) {
  const profile = diver.rentalFit;
  // Recording a first fit is data entry, open to any staff member; only
  // rewriting one already on file is the gated override (H-06).
  const mayEdit = canOverride || !profile;
  const offered = offeredRentableItems(rentalItems);
  const offers = new Set(offered.map((item) => item.kind));
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="rental-fit-heading">
      <div>
        <h2 id="rental-fit-heading" className="text-lg font-semibold">
          Rental fit
        </h2>
        <p className="mt-1 text-sm text-muted">
          What this diver takes from the shop, and in what size. It is what the trip prep list is
          built from — never an equipment reservation or a substitute for a dock-side fit check.
        </p>
      </div>
      {mayEdit ? null : (
        <p className="mt-4 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm text-muted">
          <span className="font-medium text-foreground">{rentalFitLine(profile ?? null).text}</span>
          <br />
          Changing what this diver asked for is limited to owners, managers, instructors, and
          divemasters. If a size isn’t available, flag them for hands-on fitting below.
        </p>
      )}

      {mayEdit ? (
        <FieldGrid
          as="form"
          action={saveProfileAction.bind(null, shopSlug, personId)}
          columns={2}
          className="mt-4 rounded-lg border border-border bg-surface p-5"
        >
          {offered.length > 0 ? (
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium">Rents from the shop</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {offered.map(({ name, field, label, defaultRented }) => (
                  <label
                    key={name}
                    className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"
                  >
                    <input
                      name={name}
                      type="checkbox"
                      defaultChecked={profile?.[field] ?? defaultRented}
                      className="size-4 accent-primary"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {offers.has("bcd") ? (
            <Field label="BCD size">
              <input
                name="bcdSize"
                defaultValue={profile?.bcdSize ?? ""}
                placeholder="M"
                className={controlClass}
              />
            </Field>
          ) : null}
          {offers.has("wetsuit") ? (
            <Field label="Wetsuit size">
              <input
                name="wetsuitSize"
                defaultValue={profile?.wetsuitSize ?? ""}
                placeholder="3 mm / M"
                className={controlClass}
              />
            </Field>
          ) : null}
          {offers.has("wetsuit") ? (
            <Field label="Boot size">
              <input
                name="bootSize"
                defaultValue={profile?.bootSize ?? ""}
                placeholder="9"
                className={controlClass}
              />
            </Field>
          ) : null}
          {offers.has("mask_fins") ? (
            <Field label="Fin size">
              <input
                name="finSize"
                defaultValue={profile?.finSize ?? ""}
                placeholder="L"
                className={controlClass}
              />
            </Field>
          ) : null}
          {offers.has("weights") ? (
            <Field label="Weight preference" className="sm:col-span-2">
              <input
                name="weightPreference"
                defaultValue={profile?.weightPreference ?? ""}
                placeholder="Usually 12 lb with 3 mm suit"
                className={controlClass}
              />
            </Field>
          ) : null}
          <FieldActions>
            <SubmitButton pendingLabel="Saving…" className={buttonClass({ size: "lg" })}>
              Save rental fit
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      ) : null}

      <StaffFitFallback
        profile={profile}
        shopSlug={shopSlug}
        personId={personId}
        hasFit={Boolean(profile)}
        canResolve={canOverride}
      />
    </section>
  );
}

/**
 * The H-06 safe fallback: when the shop can't fill a requested size, flag the
 * diver for hands-on fitting instead of packing a size they never chose.
 *
 * *Raising* the flag is open to every staff member — it escalates to a person
 * rather than overwriting what the diver asked for, and the captain who finds
 * the empty rack is exactly who needs it. *Clearing* it is the judgement call
 * ("we can pack her stated size after all"), so it takes the same gate as
 * editing the fit: an unattributed one-tap clear would put a diver back into
 * gear nobody re-checked, which is the very thing stickiness protects against.
 */
function StaffFitFallback({
  profile,
  shopSlug,
  personId,
  hasFit,
  canResolve,
}: {
  profile: DiverProfile["rentalFit"];
  shopSlug: string;
  personId: string;
  hasFit: boolean;
  canResolve: boolean;
}) {
  const flagged = Boolean(profile?.needsStaffFitAt);
  if (!hasFit) return null;
  return (
    <form
      action={setNeedsStaffFitAction.bind(null, shopSlug, personId)}
      className={`mt-4 rounded-lg border p-5 ${flagged ? "border-warning/40 bg-warning/5" : "border-border bg-surface"}`}
    >
      <h3 className="text-sm font-medium">
        {flagged ? "Flagged for hands-on fitting" : "Can’t fill one of these sizes?"}
      </h3>
      <p className="mt-1 text-sm text-muted">
        {flagged
          ? "Flagged for hands-on fitting — they still count on the prep list, but without a size, and the crew fits them from what’s aboard at check-in."
          : "Flag them for hands-on fitting at check-in. Their count stays on the packing list but the size comes off, so nobody lays out a size the shop is short of — better than quietly substituting one."}
      </p>
      {flagged ? (
        <>
          {profile?.needsStaffFitNote ? (
            <p className="mt-2 text-sm font-medium">{profile.needsStaffFitNote}</p>
          ) : null}
          {canResolve ? (
            <SubmitButton
              pendingLabel="Clearing…"
              className={buttonClass({ variant: "secondary", className: "mt-4 text-foreground" })}
            >
              Fit resolved — pack their sizes again
            </SubmitButton>
          ) : (
            <p className="mt-3 text-sm text-muted">
              Clearing this is limited to owners, managers, instructors, and divemasters — they
              confirm the diver can be packed to their stated sizes again.
            </p>
          )}
        </>
      ) : (
        <FieldGrid columns={1} className="mt-3">
          <Field label="What’s short" hint="(optional)">
            <input
              name="needsStaffFitNote"
              maxLength={200}
              placeholder="No L BCD in stock"
              className={controlClass}
            />
          </Field>
          <FieldActions>
            {/* The checkbox the action reads; checked because this form only sets the flag. */}
            <input type="hidden" name="needed" value="on" />
            <SubmitButton
              pendingLabel="Flagging…"
              className={buttonClass({ variant: "secondary", className: "text-foreground" })}
            >
              Flag for staff fit
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      )}
    </form>
  );
}
