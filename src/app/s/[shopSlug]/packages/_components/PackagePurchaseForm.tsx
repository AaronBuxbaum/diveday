"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoicePill, controlClass, Field, FormStatus } from "@/components/ui/form";
import { buyPackageAction, type PackagePurchaseState } from "../actions";

/** One package as the page offers it, every figure already in the diver's words. */
export type PackageOffer = {
  id: string;
  name: string;
  /** "$450", for the pill and the button. */
  priceText: string;
  /** "10 dives · $45 a dive · Any departure · Use by Dec 31, 2026". */
  facts: string;
};

const INITIAL_STATE: PackagePurchaseState = {};

/**
 * Pick a package, say who it is for, and go to Stripe's payment page.
 *
 * One form for the whole price list rather than a Buy button per row: a diver
 * buys one package at a time, and a name and an email asked once read as one
 * purchase, not as a row of forms. The button names the price of whichever
 * package is picked, so what the diver taps is what Stripe will ask for.
 */
export function PackagePurchaseForm({
  shopSlug,
  offers,
}: {
  shopSlug: string;
  offers: readonly PackageOffer[];
}) {
  const t = useTranslations();
  const [state, formAction] = useActionState(buyPackageAction.bind(null, shopSlug), INITIAL_STATE);
  const [selectedId, setSelectedId] = useState(offers[0]?.id ?? "");
  // After a refusal React resets the form; the pick follows what was posted.
  const [postedId, setPostedId] = useState(state.packageId);
  if (state.packageId !== postedId) {
    setPostedId(state.packageId);
    if (state.packageId) setSelectedId(state.packageId);
  }
  // The flag the e2e suite waits on before it taps Buy, as on the staff forms:
  // the button's price follows the picked package only once React is running.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const selected = offers.find((offer) => offer.id === selectedId) ?? offers[0];
  if (!selected) return null;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-6"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <fieldset>
        <legend className="sr-only">{t("packages.title")}</legend>
        <div className="flex flex-col gap-2">
          {offers.map((offer) => (
            <ChoicePill
              key={offer.id}
              type="radio"
              size="md"
              name="packageId"
              value={offer.id}
              checked={offer.id === selected.id}
              onChange={() => setSelectedId(offer.id)}
              aside={<span className="font-semibold tabular-nums">{offer.priceText}</span>}
            >
              <span className="block font-semibold">{offer.name}</span>
              <span className="block text-sm text-muted">{offer.facts}</span>
            </ChoicePill>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("common.name")}>
          <input
            name="name"
            required
            maxLength={120}
            autoComplete="name"
            defaultValue={state.name}
            className={controlClass}
          />
        </Field>
        <Field label={t("common.email")}>
          <input
            name="email"
            type="email"
            required
            maxLength={200}
            inputMode="email"
            autoComplete="email"
            defaultValue={state.email}
            className={controlClass}
          />
        </Field>
      </div>

      <FormStatus>{state.error}</FormStatus>

      <div className="flex flex-col items-start gap-2">
        <SubmitButton pendingLabel={t("packages.buying")} className={buttonClass({})}>
          {t("packages.buy", { amount: selected.priceText })}
        </SubmitButton>
        <p className="text-sm text-muted">{t("packages.afterPaying")}</p>
      </div>
    </form>
  );
}
