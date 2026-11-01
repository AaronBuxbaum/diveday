import { useTranslations } from "next-intl";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { RENTAL_FIT_TEXT_LIMITS, type RentableItemKind, type SuitChoice } from "@/lib/rentals";
import type { RentalFit } from "./types";

/** The rented items that take a size, any one of which opens the sizes block. */
const SIZED_KINDS: readonly RentableItemKind[] = [
  "bcd",
  "wetsuit",
  "drysuit",
  "hood",
  "gloves",
  "fins",
  "weights",
];

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

/**
 * A drysuit is not sized on the wetsuit scale above (issue 1414): a rental wall
 * is racked on the manufacturer grid, where a girth letter carries a second
 * axis the wetsuit has none of — the cut. One rule holds this list together: a
 * girth letter, optionally followed by `T` for the tall cut. The second
 * character therefore means exactly one thing wherever it appears.
 *
 * That rule is what a `dive-domain-expert` pass took off the provisional list.
 * `MS` and `ML` shipped here as in-between *girths* while `MT` beside them was
 * a *height*, and both readings are real — manufacturer charts gloss `MS` as
 * medium short and `ML` as medium large — so a diver picking `MS` for a short
 * torso and a packer reading it as a girth were never naming the same suit.
 * They join `LS` and `MLT`: real sizes, rarely stocked as rentals, and a shop
 * holding one records it staff-side, where the field is free text. `XS` goes
 * back on: every major maker publishes it, a cold-water fleet stocks it, and
 * the wetsuit select one field above starts there — so its absence read to a
 * small-framed diver as "this shop has nothing for me".
 *
 * The grid is the owner's call and is open as **H-20260912-drysuit-sizes-diver-own** in
 * `docs/product/human-decisions/README.md`, which carries the two questions this list
 * cannot answer for itself: the short cut is missing where the tall one is not,
 * and a diver may not know their drysuit size at all. This list ships
 * provisionally. Only this array depends on the answer — the column is `text`
 * and the staff field is free text — so changing the grid is an edit to this
 * one line.
 */
const DRYSUIT_SIZES = ["XS", "S", "M", "MT", "L", "LT", "XL", "XLT", "XXL"];

/**
 * The grid, plus a stored value the grid cannot represent.
 *
 * The mechanism, not the symptom: a controlled `<select>` whose `value`
 * matches no option leaves `selectedIndex` at -1, so the box paints **blank**
 * while `drysuitOk` below happily reports a size on file. And because an
 * unselected single select contributes no entry to the submitted form data,
 * the stored value survives only until the diver touches the box — at which
 * point a grid value overwrites the one field on the fit that reaches the
 * packing list verbatim (`drysuit_size` in `src/db/schema.ts`, read by
 * `src/lib/dive-prep.ts`, where a neoprene-sock fleet records "ML, rock boot
 * 9"). Silent data loss, and the crew find out at the dock.
 *
 * Off-grid values are sanctioned rather than accidental: H-20260912-drysuit-sizes-diver-own
 * (`docs/product/human-decisions/README.md`) says `MS`, `ML`, `LS` and `MLT` are real
 * sizes a shop that stocks one records staff-side, where the field is free
 * text. Offering the stored value as an option makes it visible, selected, and
 * preserved by any save that does not deliberately change it.
 *
 * Trimmed before comparing: the staff writer trims on write, but nothing
 * guarantees every existing row is trimmed, and an untrimmed `" MT "` would
 * otherwise be offered as a spurious second option beside `MT`.
 */
function optionsWithStored(grid: readonly string[], stored: string | null | undefined) {
  const value = (stored ?? "").trim();
  return value && !grid.includes(value) ? [value, ...grid] : grid;
}

/**
 * Whether an option is the stored off-grid value rather than a grid code, so
 * the select can say what it is.
 *
 * Rendered bare, the stored string sits above nine clean letters looking like a
 * mistake to tidy up — and the diver's plausible move is to "correct" it to the
 * letter they believe they are, which writes away the shop's own encoding of a
 * boot the fleet does not stock separately. Closing the *accidental* overwrite
 * without saying anything leaves the innocent one wide open (domain review of
 * issue #1728).
 */
const isStoredOffGrid = (grid: readonly string[], option: string) => !grid.includes(option);

export type RentalSizeValues = {
  bcd: string;
  wetsuit: string;
  drysuit: string;
  fin: string;
  boot: string;
};

/**
 * The size fields of the rental fit: the three sized selects, then the free-text
 * hood, glove, fin and weight boxes, each only when the shop rents that kit. The
 * four controlled values live in {@link RentalFitForm}, which needs them to say
 * whether the fit is confirmed; this component only draws and reports changes.
 */
export function RentalSizeFields({
  offers,
  rentalFit,
  suit,
  sizes,
  onSize,
}: {
  offers: ReadonlySet<RentableItemKind>;
  rentalFit: RentalFit;
  suit: SuitChoice;
  sizes: RentalSizeValues;
  onSize: (field: keyof RentalSizeValues, value: string) => void;
}) {
  const t = useTranslations();
  const sizesOffered = SIZED_KINDS.some((kind) => offers.has(kind));
  const bcdSize = sizes.bcd;
  const wetsuitSize = sizes.wetsuit;
  const drysuitSize = sizes.drysuit;
  const finSize = sizes.fin;
  const setBcdSize = (value: string) => onSize("bcd", value);
  const setWetsuitSize = (value: string) => onSize("wetsuit", value);
  const setDrysuitSize = (value: string) => onSize("drysuit", value);
  const setFinSize = (value: string) => onSize("fin", value);
  // From the prop, deliberately, not from the live state: derived from state
  // the off-grid option would vanish the instant the diver picked a grid size,
  // and they could not undo an accidental change without reloading the page.
  // From the prop it stays in the list, unselected, and is revertible.
  const bcdOptions = optionsWithStored(SIZES, rentalFit?.bcdSize);
  const wetsuitOptions = optionsWithStored(SIZES, rentalFit?.wetsuitSize);
  const drysuitOptions = optionsWithStored(DRYSUIT_SIZES, rentalFit?.drysuitSize);
  return (
    <>
      {/* `weights` rides in this grid rather than in a full-width row of its
            own below: at two columns the three size fields leave a hole beside
            the third, and "Usual weight setup" is the same shape of answer as
            the fields it now sits with. On a phone the grid is one column and
            the order is unchanged. */}
      {sizesOffered ? (
        <FieldGrid columns={2}>
          {offers.has("bcd") ? (
            <Field label={t("rental.bcdSize")}>
              <select
                name="bcdSize"
                value={bcdSize}
                onChange={(e) => setBcdSize(e.target.value)}
                className={controlClass}
              >
                <option value="">{t("rental.notSure")}</option>
                {bcdOptions.map((size) => (
                  <option key={size} value={size}>
                    {isStoredOffGrid(SIZES, size) ? t("rental.sizeOnFile", { size }) : size}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {offers.has("wetsuit") ? (
            <Field label={t("rental.wetsuitSize")}>
              <select
                name="wetsuitSize"
                value={wetsuitSize}
                onChange={(e) => setWetsuitSize(e.target.value)}
                className={controlClass}
              >
                <option value="">{t("rental.notSure")}</option>
                {wetsuitOptions.map((size) => (
                  <option key={size} value={size}>
                    {isStoredOffGrid(SIZES, size) ? t("rental.sizeOnFile", { size }) : size}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {offers.has("drysuit") ? (
            <Field label={t("rental.drysuitSize")}>
              <select
                name="drysuitSize"
                value={drysuitSize}
                onChange={(e) => setDrysuitSize(e.target.value)}
                className={controlClass}
              >
                <option value="">{t("rental.notSure")}</option>
                {drysuitOptions.map((size) => (
                  <option key={size} value={size}>
                    {isStoredOffGrid(DRYSUIT_SIZES, size) ? t("rental.sizeOnFile", { size }) : size}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {/* Free text, like the staff side's drysuit box (H-20261007-hood-glove-sizes): a hood racks
                and gloves both by size and thickness, and the diver's own words
                reach the packing list verbatim. */}
          {offers.has("hood") ? (
            <Field label={t("rental.hoodSize")} hint={t("common.optional")}>
              <input
                name="hoodSize"
                maxLength={RENTAL_FIT_TEXT_LIMITS.size}
                defaultValue={rentalFit?.hoodSize ?? ""}
                placeholder={t("rental.hoodSizePlaceholder")}
                className={controlClass}
              />
            </Field>
          ) : null}
          {offers.has("gloves") ? (
            <Field label={t("rental.gloveSize")} hint={t("common.optional")}>
              <input
                name="gloveSize"
                maxLength={RENTAL_FIT_TEXT_LIMITS.size}
                defaultValue={rentalFit?.gloveSize ?? ""}
                placeholder={t("rental.gloveSizePlaceholder")}
                className={controlClass}
              />
            </Field>
          ) : null}
          {offers.has("fins") ? (
            <Field label={t("rental.finSize")} hint={t("common.optional")}>
              <input
                name="finSize"
                maxLength={RENTAL_FIT_TEXT_LIMITS.size}
                value={finSize}
                onChange={(e) => setFinSize(e.target.value)}
                placeholder={t("rental.finSizePlaceholder")}
                className={controlClass}
              />
            </Field>
          ) : null}
          {offers.has("wetsuit") ? (
            <Field label={t("rental.bootSize")} hint={t("common.optional")}>
              <input
                name="bootSize"
                maxLength={RENTAL_FIT_TEXT_LIMITS.size}
                value={sizes.boot}
                onChange={(event) => onSize("boot", event.target.value)}
                placeholder={t("rental.finSizePlaceholder")}
                className={controlClass}
              />
            </Field>
          ) : null}
          {offers.has("weights") ? (
            <Field label={t("rental.weightSetup")} hint={t("common.optional")}>
              <input
                name="weightPreference"
                maxLength={RENTAL_FIT_TEXT_LIMITS.weightPreference}
                defaultValue={rentalFit?.weightPreference ?? ""}
                // The example follows the suit: a wetsuit number is short for
                // a diver in a drysuit (H-20260916-rental-fit-describe-shop).
                placeholder={
                  suit === "own_drysuit" || suit === "rents_drysuit"
                    ? t("rental.weightPlaceholderDry")
                    : t("rental.weightPlaceholder")
                }
                className={controlClass}
              />
            </Field>
          ) : null}
        </FieldGrid>
      ) : null}
    </>
  );
}
