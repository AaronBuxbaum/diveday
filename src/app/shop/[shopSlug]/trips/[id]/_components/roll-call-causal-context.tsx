"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { RollCallCausalContext } from "@/lib/roll-call-causality";

const Context = createContext<Record<string, RollCallCausalContext>>({});

export function RollCallCausalProvider({
  contexts,
  children,
}: {
  contexts: Record<string, RollCallCausalContext>;
  children: ReactNode;
}) {
  return <Context value={contexts}>{children}</Context>;
}

export function useRollCallCausalContext(field: string, id: string) {
  return useContext(Context)[`${field}:${id}`];
}
