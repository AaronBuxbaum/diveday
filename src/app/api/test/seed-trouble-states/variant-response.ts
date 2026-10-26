import type { AppDb } from "@/db/client";
import { authStateResponse } from "./auth-state";
import { operationalStateResponse } from "./operational-states";
import { settingsStateResponse } from "./settings-state";

/** Called only after the route's unchanged harness/secret/real-database gate. */
export async function troubleVariantResponse(request: Request, db: AppDb) {
  return (
    (await authStateResponse(request, db)) ??
    (await settingsStateResponse(request, db)) ??
    (await operationalStateResponse(request, db))
  );
}
