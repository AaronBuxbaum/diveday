/**
 * The dive log's species marker. The form draws `speciesShown=1` next to the
 * species picker, and only there, so the save knows whether the crew saw the
 * picker when the form loaded, whatever the Sightings switch says by the time
 * they press Save (ADR 20261005-optional-shop-features).
 *
 * With the marker, the save writes the species the form posted, empty
 * included. Without it, the form drew no picker, and the save keeps the
 * species already logged rather than erasing it.
 */
export const SPECIES_SHOWN_FIELD = "speciesShown";

export function formShowedSpecies(formData: FormData): boolean {
  return formData.get(SPECIES_SHOWN_FIELD) === "1";
}
