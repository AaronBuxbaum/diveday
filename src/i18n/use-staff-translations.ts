"use client";

import { useTranslations } from "next-intl";
import type { StaffNamespace } from "./StaffIntlProvider";
import type { StaffMessageKey } from "./staff-messages";

/** The keys under one staff namespace, written without the namespace. */
export type StaffKeyIn<N extends StaffNamespace> = StaffMessageKey extends infer K
  ? K extends `${N}.${infer Rest}`
    ? Rest
    : never
  : never;

type StaffScopedTranslator<N extends StaffNamespace> = (
  key: StaffKeyIn<N>,
  values?: Record<string, string | number>,
) => string;

/**
 * `useTranslations` for a staff Client Component, typed against the staff bundle. `useTranslations`
 * itself types against the diver `AppConfig.Messages`, so this is the one place that cast lives.
 * A key the bundle lacks is a type error here, and a namespace the provider above does not carry
 * renders as its key (the same silent failure the diver hook has, caught by the e2e page).
 */
export function useStaffTranslations<N extends StaffNamespace>(
  namespace: N,
): StaffScopedTranslator<N> {
  return useTranslations(namespace as never) as unknown as StaffScopedTranslator<N>;
}
