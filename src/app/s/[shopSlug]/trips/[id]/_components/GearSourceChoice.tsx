"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ChoiceFieldset, ChoicePill } from "@/components/ui/form";
import type { DiverMessageKey } from "@/i18n/messages";
import {
  type offeredRentableItems,
  type RentableItemKind,
  type SuitChoice,
  suitFlags,
} from "@/lib/rentals";

/**
 * **The first question of the gear step: is the diver bringing their own gear?** (Aaron,
 * 2026-11-11, #4337.) The default stays "I need everything", which is right for a diver who needs
 * gear. The other two answers are one tap for a diver who owns it, so finishing the row never
 * means unticking seven things. A course with gear in its fee is not asked: its ticks already
 * start from the fee.
 */
export type GearSource = "own" | "some" | "everything";

const GEAR_SOURCES: readonly GearSource[] = ["own", "some", "everything"];

const GEAR_SOURCE_KEYS: Record<GearSource, DiverMessageKey> = {
  own: "rental.gearSource.own",
  some: "rental.gearSource.some",
  everything: "rental.gearSource.everything",
};

export function GearSourceChoice({
  value,
  onChange,
}: {
  value: GearSource;
  onChange: (source: GearSource) => void;
}) {
  const t = useTranslations();
  return (
    <ChoiceFieldset legend={t("rental.gearSourceLegend")}>
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-3">
        {GEAR_SOURCES.map((source) => (
          <ChoicePill
            key={source}
            type="radio"
            name="gearSource"
            value={source}
            checked={value === source}
            onChange={() => onChange(source)}
          >
            {t(GEAR_SOURCE_KEYS[source])}
          </ChoicePill>
        ))}
      </div>
    </ChoiceFieldset>
  );
}

/**
 * Which answer the ticks and the suit amount to, and what each answer sets. "Some of it" sets
 * nothing: it is where the diver lands by editing a single piece.
 */
export function useGearSource({
  ticked,
  fee,
  suitOptions,
  storedSuit,
  tickedKinds,
  suit,
}: {
  ticked: ReturnType<typeof offeredRentableItems>;
  fee: ReadonlySet<RentableItemKind>;
  suitOptions: readonly SuitChoice[];
  storedSuit: SuitChoice;
  tickedKinds: ReadonlySet<RentableItemKind>;
  suit: SuitChoice;
}) {
  const everythingKinds = new Set(
    ticked.filter((item) => item.defaultRented && !fee.has(item.kind)).map((item) => item.kind),
  );
  const ownSuit: SuitChoice = suitOptions.includes("own_wetsuit") ? "own_wetsuit" : storedSuit;
  const rentedSuit: SuitChoice =
    suitOptions.find((choice) => choice === "rents_wetsuit" || choice === "rents_drysuit") ??
    storedSuit;
  const sourceOf = (kinds: ReadonlySet<RentableItemKind>, chosenSuit: SuitChoice): GearSource => {
    const suitRents = suitFlags(chosenSuit).rentsWetsuit || suitFlags(chosenSuit).rentsDrysuit;
    if (kinds.size === 0 && !suitRents) return "own";
    const allTicked = [...everythingKinds].every((kind) => kinds.has(kind));
    return allTicked && (suitRents || suitOptions.length === 0) ? "everything" : "some";
  };
  const [source, setSource] = useState<GearSource>(() => sourceOf(tickedKinds, suit));
  return {
    source,
    setSource,
    sourceOf,
    /** The ticks and suit an answer sets, or null for "Some of it". */
    apply: (answer: GearSource) =>
      answer === "own"
        ? { kinds: new Set<RentableItemKind>(), suit: ownSuit }
        : answer === "everything"
          ? { kinds: new Set<RentableItemKind>(everythingKinds), suit: rentedSuit }
          : null,
  };
}
