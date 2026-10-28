import { useCallback, useEffect, useState } from "react";
import {
  forgetReturningDiver,
  loadReturningDiver,
  type ReturningDiver,
} from "@/lib/returning-diver";
import { MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";

export type PartyMember = { fullName: string; email: string };

export const emptyMember: PartyMember = { fullName: "", email: "" };

/**
 * **The party's names and addresses**, one slot per bookable seat, the lead's
 * filled from what the page already knows. With a shop slug and no known lead,
 * the first slot is filled from this device's unexpired opt-in memory for that
 * shop; `forgetRememberedDiver` removes that shop's saved memory.
 */
export function usePartyMembers(
  lead: { fullName: string; email?: string | null } | null | undefined,
  rememberForShop: string | null | undefined,
) {
  const [party, setParty] = useState<PartyMember[]>(() =>
    Array.from({ length: MAX_PUBLIC_PARTY_SIZE }, (_, index) =>
      index === 0 && lead
        ? { fullName: lead.fullName, email: lead.email ?? "" }
        : { ...emptyMember },
    ),
  );
  const [rememberedDiver, setRememberedDiver] = useState<ReturningDiver | null>(null);

  const updateMember = useCallback((index: number, patch: Partial<PartyMember>) => {
    setParty((current) => current.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }, []);

  useEffect(() => {
    if (!rememberForShop || lead) return;
    const stored = loadReturningDiver(rememberForShop);
    if (!stored) return;
    setRememberedDiver(stored);
    updateMember(0, { fullName: stored.fullName, email: stored.email });
  }, [rememberForShop, lead, updateMember]);

  function forgetRememberedDiver() {
    if (rememberForShop) forgetReturningDiver(rememberForShop);
    setRememberedDiver(null);
    updateMember(0, { fullName: "", email: "" });
  }

  return { party, updateMember, rememberedDiver, forgetRememberedDiver };
}
