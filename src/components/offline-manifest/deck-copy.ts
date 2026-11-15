import type { DeckCopy } from "./DeckFlow";

export function deckCopy(
  t: (key: `manifest.deck.${keyof DeckCopy | "observedLabel"}`) => string,
): DeckCopy {
  return {
    title: t("manifest.deck.title"),
    start: t("manifest.deck.start"),
    next: t("manifest.deck.next"),
    later: t("manifest.deck.later"),
    find: t("manifest.deck.find"),
    search: t("manifest.deck.search"),
    home: t("manifest.deck.home"),
    details: t("manifest.deck.details"),
    exception: t("manifest.deck.exception"),
    receipt: t("manifest.deck.receipt"),
    pendingReceipt: t("manifest.deck.pendingReceipt"),
    complete: t("manifest.deck.complete"),
    attention: t("manifest.deck.attention"),
    review: t("manifest.deck.review"),
    empty: t("manifest.deck.empty"),
    observe: t("manifest.deck.observe"),
    now: t("manifest.deck.now"),
    savedAboard: t("manifest.deck.savedAboard"),
    savedAshore: t("manifest.deck.savedAshore"),
    savedMissing: t("manifest.deck.savedMissing"),
    observed: t("manifest.deck.observedLabel"),
  };
}
