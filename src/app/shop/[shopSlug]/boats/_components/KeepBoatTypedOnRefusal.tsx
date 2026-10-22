"use client";

import { useEffect, useRef } from "react";
import { applyFormFields } from "@/components/apply-form-fields";
import { KeepTypedOnRefusal, readKeptTyped } from "@/components/KeepTypedOnRefusal";

const FORM = "boats-add";
const PAPER_DATES = [
  ["coiExpiresOn", "boatPaperCoiDate"],
  ["registrationExpiresOn", "boatPaperRegistrationDate"],
  ["insuranceExpiresOn", "boatPaperInsuranceDate"],
] as const;

/**
 * Keep the three boat-document dates without changing the shared expiry-field
 * exclusion for payment details. Only these named business dates get aliases;
 * the shared helper still bounds the stored fields and owns scope and lifetime.
 */
export function KeepBoatTypedOnRefusal({ scope, restore }: { scope: string; restore: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const dates = PAPER_DATES.flatMap(([name, alias]) => {
      const input = form.elements.namedItem(name);
      const hidden = form.elements.namedItem(alias);
      if (!(input instanceof HTMLInputElement) || !(hidden instanceof HTMLInputElement)) {
        return [];
      }
      const previousAlias = input.getAttribute("data-draft-for");
      input.setAttribute("data-draft-for", alias);
      return [{ input, hidden, alias, previousAlias }];
    });
    const restoreDates = () => {
      if (!restoreRef.current) return;
      // Read the same scoped storage directly: neither mount nor reset relies
      // on whether the shared helper's restoration effect ran first.
      const kept = readKeptTyped(FORM, scope);
      if (!kept) return;
      const values: Record<string, string> = {};
      for (const { alias } of dates) {
        if (typeof kept[alias] === "string") values[alias] = kept[alias];
      }
      applyFormFields(form, values);
    };
    const onSubmit = () => {
      for (const { input, hidden } of dates) hidden.value = input.value;
    };
    let frame = 0;
    const onReset = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(restoreDates);
    };

    if (restore) restoreDates();
    // Capture precedes the shared helper's submit listener, regardless of
    // effect registration order, so its FormData includes all three dates.
    form.addEventListener("submit", onSubmit, true);
    form.addEventListener("reset", onReset);
    return () => {
      cancelAnimationFrame(frame);
      form.removeEventListener("submit", onSubmit, true);
      form.removeEventListener("reset", onReset);
      for (const { input, alias, previousAlias } of dates) {
        if (input.getAttribute("data-draft-for") !== alias) continue;
        if (previousAlias === null) input.removeAttribute("data-draft-for");
        else input.setAttribute("data-draft-for", previousAlias);
      }
    };
  }, [scope, restore]);

  return (
    <>
      <KeepTypedOnRefusal form={FORM} scope={scope} restore={restore} />
      <span ref={anchor} hidden>
        {PAPER_DATES.map(([, alias]) => (
          <input key={alias} type="hidden" name={alias} defaultValue="" />
        ))}
      </span>
    </>
  );
}
