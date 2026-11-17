"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { keptTypedKey } from "@/components/kept-typed-scope";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import type { OrderableCustomer } from "@/db/orders";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import { searchOrderCustomersAction } from "../customer-search-actions";

export type CustomerPickerWords = {
  label: string;
  placeholder: string;
  /** Said on the box when the form is sent with nobody chosen. */
  choose: string;
  change: string;
  noMatches: string;
  /** More people match than are shown: keep typing. */
  more: string;
};

/** A refusal comes back in a second; a chosen customer older than this is a different visit. */
const KEPT_FOR_MS = 10 * MINUTE_MS;

function readKeptCustomer(key: string): OrderableCustomer | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; customer?: Partial<OrderableCustomer> };
    const { at, customer } = parsed;
    if (typeof at !== "number" || nowMs() - at > KEPT_FOR_MS) return null;
    if (typeof customer?.id !== "string" || typeof customer.fullName !== "string") return null;
    return { id: customer.id, fullName: customer.fullName, email: customer.email ?? null };
  } catch {
    return null;
  }
}

function writeKeptCustomer(key: string, customer: OrderableCustomer | null) {
  try {
    if (customer) window.sessionStorage.setItem(key, JSON.stringify({ at: nowMs(), customer }));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage refused: a refusal then shows the search box again, as before.
  }
}

/** How long typing rests before the search is asked; a name is typed in bursts. */
const SEARCH_PAUSE_MS = 200;

/**
 * **Who the order is for, found by typing** (issue #4601). Both order forms
 * used to list every live person in the shop in one `<select>`, which for a
 * shop with years of divers is thousands of options in the page. Now the box
 * asks the server for a few matches by name, email or phone as the staffer
 * types (`searchOrderCustomersAction`), says when more match than are shown,
 * and holds the one chosen in a hidden `name` field. A link that named the
 * customer opens with them chosen.
 *
 * `emptyValue` is what the form sends with nobody chosen: nothing for a new
 * invoice, which needs a customer, and `walk-in` for a recorded purchase,
 * where nobody in particular is an answer.
 */
export function CustomerPicker({
  name,
  initial,
  emptyValue = "",
  required = false,
  description,
  onChange,
  words,
  keep,
}: {
  name: string;
  initial: OrderableCustomer | null;
  emptyValue?: string;
  required?: boolean;
  description?: string;
  onChange?: (personId: string) => void;
  words: CustomerPickerWords;
  /**
   * Keeps the chosen person for this tab so a refusal of the form still shows
   * who was chosen: the form's scope, and whether this page is that refusal.
   */
  keep?: { scope: string; restore: boolean };
}) {
  const [chosen, setChosen] = useState<OrderableCustomer | null>(initial);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<{
    query: string;
    customers: OrderableCustomer[];
    more: boolean;
  } | null>(null);
  const [, startSearch] = useTransition();
  const asked = useRef(0);
  const box = useRef<HTMLInputElement>(null);
  const resultsId = useId();

  useEffect(() => {
    const typed = query.trim();
    if (!typed) {
      setAnswer(null);
      return;
    }
    const ask = ++asked.current;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const found = await searchOrderCustomersAction(typed);
        // Only the newest question's answer lands; a slow early one is dropped.
        if (ask === asked.current) setAnswer({ query: typed, ...found });
      });
    }, SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const keptKey = keep ? keptTypedKey("order-customer", keep.scope) : null;
  const restoring = keep?.restore ?? false;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!keptKey) return;
    if (!restoring) {
      writeKeptCustomer(keptKey, null);
      return;
    }
    const kept = readKeptCustomer(keptKey);
    if (!kept) return;
    setChosen((now) => now ?? kept);
    onChangeRef.current?.(kept.id);
  }, [keptKey, restoring]);

  // A required picker refuses the send while nobody is chosen, on the box.
  useEffect(() => {
    box.current?.setCustomValidity(required && !chosen ? words.choose : "");
  }, [required, chosen, words.choose]);

  function choose(customer: OrderableCustomer | null) {
    setChosen(customer);
    if (keptKey) writeKeptCustomer(keptKey, customer);
    setQuery("");
    setAnswer(null);
    onChange?.(customer?.id ?? emptyValue);
    if (!customer) requestAnimationFrame(() => box.current?.focus());
  }

  return (
    <div>
      <input type="hidden" name={name} value={chosen?.id ?? emptyValue} />
      {chosen ? (
        <Field label={words.label} description={description} group>
          <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">{chosen.fullName}</span>
            {chosen.email ? <span className="text-sm text-muted">{chosen.email}</span> : null}
            <button
              type="button"
              className={buttonClass({ variant: "link", flush: "padded" })}
              onClick={() => choose(null)}
            >
              {words.change}
            </button>
          </div>
        </Field>
      ) : (
        <Field label={words.label} description={description}>
          <input
            ref={box}
            type="search"
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
            placeholder={words.placeholder}
            aria-controls={resultsId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={controlClass}
          />
        </Field>
      )}
      {!chosen && answer && answer.query === query.trim() ? (
        <div id={resultsId} aria-live="polite" className="mt-2">
          {answer.customers.length === 0 ? (
            <p className="text-sm text-muted">{words.noMatches}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {answer.customers.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-start hover:bg-foreground/5"
                    onClick={() => choose(customer)}
                  >
                    <span className="font-medium">{customer.fullName}</span>
                    {customer.email ? (
                      <span className="text-sm text-muted">{customer.email}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {answer.more ? <p className="mt-2 text-sm text-muted">{words.more}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
