"use client";

import { useEffect } from "react";
import { keptTypedKey } from "@/components/kept-typed-scope";
import { nowMs } from "@/lib/clock";
import { isUuid } from "@/lib/uuid";
import { INVOICE_FORM, readRetainedInvoice } from "./retained-invoice";

/** A successful create has landed on its order; this session's submitted draft is finished. */
export function ClearCreatedInvoice({ scope, receipt }: { scope: string; receipt: string }) {
  useEffect(() => {
    if (!isUuid(receipt)) return;
    try {
      const key = keptTypedKey(INVOICE_FORM, scope);
      const draft = readRetainedInvoice(window.sessionStorage.getItem(key), nowMs());
      if (draft?.attempt === receipt) window.sessionStorage.removeItem(key);
    } catch {
      /* Nothing persisted. */
    }
  }, [scope, receipt]);
  return null;
}
