import { useEffect, useState } from "react";
import { loadReturningDiver, type ReturningDiver } from "@/lib/returning-diver";
import { MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";

export type PartyMember = { fullName: string; email: string };

export const emptyMember: PartyMember = { fullName: "", email: "" };

/**
 * **The party's names and addresses**, one slot per bookable seat, the lead's
 * filled from what the page already knows. With `remember` and no known lead,
 * the first slot is filled once on mount from the diver this device remembers
 * (`loadReturningDiver`), and `forgetRememberedDiver` empties it again.
 */
export function usePartyMembers(
  lead: { fullName: string; email?: string | null } | null | undefined,
  remember: boolean | undefined,
) {
  const [party, setParty] = useState<PartyMember[]>(() =>
    Array.from({ length: MAX_PUBLIC_PARTY_SIZE }, (_, index) =>
      index === 0 && lead
        ? { fullName: lead.fullName, email: lead.email ?? "" }
        : { ...emptyMember },
    ),
  );
  const [rememberedDiver, setRememberedDiver] = useState<ReturningDiver | null>(null);

  function updateMember(index: number, patch: Partial<PartyMember>) {
    setParty((current) => current.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: only ever applied once on mount
  useEffect(() => {
    if (!remember || lead) return;
    const stored = loadReturningDiver();
    if (!stored) return;
    setRememberedDiver(stored);
    updateMember(0, { fullName: stored.fullName, email: stored.email });
  }, [remember]);

  function forgetRememberedDiver() {
    setRememberedDiver(null);
    updateMember(0, { fullName: "", email: "" });
  }

  return { party, updateMember, rememberedDiver, forgetRememberedDiver };
}
