"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  forgetReturningDiver,
  hasStoredReturningDiver,
  loadReturningDiverRecord,
  type ReturningDiver,
  snapshotReturningDiverClearGenerations,
  subscribeToReturningDiverClears,
} from "@/lib/returning-diver";
import { MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";

export type PartyMember = { fullName: string; email: string };

export const emptyMember: PartyMember = { fullName: "", email: "" };

/**
 * **The party's names and addresses**, one slot per bookable seat, the lead's
 * filled from what the page already knows. A saved lead is checked against the
 * server clock before prefill; clearing it removes only untouched remembered
 * values from this tab and any other open form.
 */
export function usePartyMembers(
  lead: { fullName: string; email?: string | null } | null | undefined,
  rememberForShop: string | null | undefined,
  getTrustedServerTime?: () => Promise<number>,
) {
  const [party, setParty] = useState<PartyMember[]>(() =>
    Array.from({ length: MAX_PUBLIC_PARTY_SIZE }, (_, index) =>
      index === 0 && lead
        ? { fullName: lead.fullName, email: lead.email ?? "" }
        : { ...emptyMember },
    ),
  );
  const [rememberedDiver, setRememberedDiver] = useState<ReturningDiver | null>(null);
  const [forgetCouldNotConfirm, setForgetCouldNotConfirm] = useState(false);
  const rememberedRef = useRef<ReturningDiver | null>(null);
  const manuallyEditedLead = useRef({ fullName: false, email: false });

  const updateMember = useCallback((index: number, patch: Partial<PartyMember>) => {
    if (index === 0) {
      if (Object.hasOwn(patch, "fullName")) manuallyEditedLead.current.fullName = true;
      if (Object.hasOwn(patch, "email")) manuallyEditedLead.current.email = true;
    }
    setParty((current) =>
      current.map((member, i) => (i === index ? { ...member, ...patch } : member)),
    );
  }, []);

  useEffect(() => {
    if (!rememberForShop) return;
    return subscribeToReturningDiverClears((clear) => {
      if (clear.shopSlug !== rememberForShop) return;
      const previous = rememberedRef.current;
      if (!previous) return;
      const finishClear = (nextMemory: ReturningDiver | null) => {
        setParty((current) =>
          current.map((member, index) => {
            if (index !== 0) return member;
            return {
              fullName: manuallyEditedLead.current.fullName
                ? member.fullName
                : member.fullName === previous.fullName
                  ? (nextMemory?.fullName ?? "")
                  : member.fullName,
              email: manuallyEditedLead.current.email
                ? member.email
                : member.email === previous.email
                  ? (nextMemory?.email ?? "")
                  : member.email,
            };
          }),
        );
        rememberedRef.current = nextMemory;
        setRememberedDiver(nextMemory);
      };
      if (!getTrustedServerTime) {
        finishClear(null);
        return;
      }
      void getTrustedServerTime()
        .then((serverNow) => {
          const latestClear = snapshotReturningDiverClearGenerations()?.[rememberForShop] ?? null;
          if (latestClear !== clear.generation) return;
          const next = loadReturningDiverRecord(rememberForShop, new Date(serverNow));
          const isNewOptIn =
            next?.clearGeneration === clear.generation &&
            (clear.receiptId ? next.receiptId !== clear.receiptId : next.receiptId !== null);
          finishClear(isNewOptIn && next ? next : null);
        })
        .catch(() => finishClear(null));
    });
  }, [rememberForShop, getTrustedServerTime]);

  useEffect(() => {
    if (
      !rememberForShop ||
      !getTrustedServerTime ||
      lead ||
      !hasStoredReturningDiver(rememberForShop)
    )
      return;
    let active = true;
    const generationAtStart = snapshotReturningDiverClearGenerations()?.[rememberForShop] ?? null;
    void getTrustedServerTime()
      .then((serverNow) => {
        if (!active) return;
        const currentGeneration =
          snapshotReturningDiverClearGenerations()?.[rememberForShop] ?? null;
        if (currentGeneration !== generationAtStart) return;
        const stored = loadReturningDiverRecord(rememberForShop, new Date(serverNow));
        if (!stored || stored.clearGeneration !== currentGeneration) return;
        rememberedRef.current = stored;
        setRememberedDiver(stored);
        setParty((current) =>
          current.map((member, index) =>
            index === 0
              ? {
                  fullName:
                    !manuallyEditedLead.current.fullName && !member.fullName
                      ? stored.fullName
                      : member.fullName,
                  email:
                    !manuallyEditedLead.current.email && !member.email
                      ? stored.email
                      : member.email,
                }
              : member,
          ),
        );
      })
      .catch(() => {
        // No trusted online time means the optional memory stays out of the form.
      });
    return () => {
      active = false;
    };
  }, [rememberForShop, lead, getTrustedServerTime]);

  function forgetRememberedDiver() {
    if (rememberForShop) {
      setForgetCouldNotConfirm(forgetReturningDiver(rememberForShop) !== "cleared");
    }
    const previous = rememberedRef.current;
    if (previous) {
      setParty((current) =>
        current.map((member, index) =>
          index === 0
            ? {
                fullName:
                  !manuallyEditedLead.current.fullName && member.fullName === previous.fullName
                    ? ""
                    : member.fullName,
                email:
                  !manuallyEditedLead.current.email && member.email === previous.email
                    ? ""
                    : member.email,
              }
            : member,
        ),
      );
    }
    rememberedRef.current = null;
    setRememberedDiver(null);
  }

  return { party, updateMember, rememberedDiver, forgetRememberedDiver, forgetCouldNotConfirm };
}
