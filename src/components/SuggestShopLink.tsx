"use client";

import { useEffect } from "react";
import { suggestShopSlug } from "@/lib/onboarding";

/**
 * Fills the shop-link field from the shop-name field as the owner types, so
 * the one "invent a URL" decision in sign-up becomes watching the link write
 * itself. Same posture as `DetectTimezone`: renders nothing, enhances the
 * page's own native inputs (so `Field`'s label/required wiring is untouched),
 * and never overwrites an answer a person gave —
 *
 * - it stays inert when the slug field already has a value on mount (a form
 *   bounced back with `?shopSlug=`), and
 * - the first keystroke *in the slug field itself* ends the suggesting for
 *   good, even if the owner then clears it.
 *
 * Progressive enhancement, not a requirement: with JavaScript unavailable the
 * field is still a plain required input.
 */
export function SuggestShopLink({ nameId, slugId }: { nameId: string; slugId: string }) {
  useEffect(() => {
    const name = document.getElementById(nameId);
    const slug = document.getElementById(slugId);
    if (!(name instanceof HTMLInputElement) || !(slug instanceof HTMLInputElement)) return;
    if (slug.dataset.slugSuggest === "wired") return;
    slug.dataset.slugSuggest = "wired";
    // A pre-filled slug is an answer, not a blank — never touch it.
    let suggesting = slug.value === "";
    const onNameInput = () => {
      if (!suggesting) return;
      slug.value = suggestShopSlug(name.value);
    };
    const onSlugInput = () => {
      suggesting = false;
    };
    name.addEventListener("input", onNameInput);
    slug.addEventListener("input", onSlugInput);
    return () => {
      name.removeEventListener("input", onNameInput);
      slug.removeEventListener("input", onSlugInput);
      delete slug.dataset.slugSuggest;
    };
  }, [nameId, slugId]);

  return null;
}
