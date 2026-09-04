"use client";

import { useEffect, useState } from "react";
import { suggestShopSlug } from "@/lib/onboarding-slug";
import { publicSchedulePath } from "@/lib/public-routes";

/**
 * The shop-link field's two halves of one idea: the link writes itself from
 * the shop's name, and the line under the box is the storefront address that
 * link produces — live, as the owner types.
 *
 * **Design: ADR 20260827-first-light, decision 1** (the door speaks
 * Clearwater). Inventing a URL is the one moment in sign-up where a shop owner
 * has to stop and *decide* something. The box used to carry a sentence
 * describing what it was for ("your shop's public web address — the page
 * divers open to book"); now the line under it *is* the answer —
 * "Your schedule will live at dive.day/s/torchlight" — and the owner watches
 * it assemble rather than imagining it. Same posture as `DetectTimezone`: it
 * enhances the page's own native inputs (so `Field`'s label/required wiring is
 * untouched) and never overwrites an answer a person gave —
 *
 * - it stays inert when the slug field already has a value on mount (a form
 *   bounced back with `?shopSlug=`), and
 * - the first keystroke *in the slug field itself* ends the suggesting for
 *   good, even if the owner then clears it.
 *
 * **The hint yields to the field's refusal, and never renders beside it.** A
 * slug that was taken or malformed comes back with a message on the box, and a
 * cheerful "your schedule will live at" underneath argues with it. The
 * component still *mounts* in that state — the suggestion wiring is the other
 * half of its job — it simply renders nothing, which is why the rule lives
 * here rather than at the call site.
 *
 * Progressive enhancement, not a requirement: with JavaScript unavailable the
 * field is still a plain required input, and the line under it still reads the
 * address the server-rendered value produces.
 */
export function SuggestShopLink({
  nameId,
  slugId,
  initialSlug = "",
  urlLead,
  urlHost,
  fieldError,
}: {
  nameId: string;
  slugId: string;
  /** The slug the server rendered into the box (a `?shopSlug=` echo, or none). */
  initialSlug?: string;
  /** "Your schedule will live at" — the words, from the caller's bundle. */
  urlLead: string;
  /** The host the storefront lives on, without a scheme (`dive.day`). */
  urlHost: string;
  /** The refusal currently on the slug field; the hint stands down while it is set. */
  fieldError?: string;
}) {
  // Normalized, not echoed: the URL says what the slug will *become*, so a
  // trailing hyphen or a capital in the box never renders as a broken address.
  const [slug, setSlug] = useState(() => suggestShopSlug(initialSlug));

  useEffect(() => {
    const name = document.getElementById(nameId);
    const slugField = document.getElementById(slugId);
    if (!(name instanceof HTMLInputElement) || !(slugField instanceof HTMLInputElement)) return;
    if (slugField.dataset.slugSuggest === "wired") return;
    slugField.dataset.slugSuggest = "wired";
    // A pre-filled slug is an answer, not a blank — never touch it.
    let suggesting = slugField.value === "";
    const onNameInput = () => {
      if (!suggesting) return;
      slugField.value = suggestShopSlug(name.value);
      setSlug(slugField.value);
    };
    const onSlugInput = () => {
      suggesting = false;
      setSlug(suggestShopSlug(slugField.value));
    };
    name.addEventListener("input", onNameInput);
    slugField.addEventListener("input", onSlugInput);
    return () => {
      name.removeEventListener("input", onNameInput);
      slugField.removeEventListener("input", onSlugInput);
      delete slugField.dataset.slugSuggest;
    };
  }, [nameId, slugId]);

  // Two silences, for the same reason: the hint only speaks when it has
  // something true to say. It yields to a field error (the refusal is the
  // message), and it yields to an empty slug — on a fresh form there is no
  // address yet, and `${urlHost}/s/` is not one. Rendering the bare host
  // instead would be the same defect wearing a shorter string.
  if (fieldError || !slug) return null;

  return (
    <>
      {urlLead}{" "}
      {/* The address is data, not prose — it carries the page's own ink so the
          owner can read the part they are actually typing. */}
      <span className="font-medium text-foreground">{`${urlHost}${publicSchedulePath(slug)}`}</span>
    </>
  );
}
