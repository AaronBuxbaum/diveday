import type { AppDb } from "@/db/client";
import { authStateResponse } from "./auth-state";
import { fiveDivePrintResponse } from "./five-dive-print-state";
import { futureCrewStateResponse } from "./future-crew-state";
import { mixedDepthStateResponse } from "./mixed-depth-state";
import { mixedTrainingStateResponse } from "./mixed-training-state";
import { operationalStateResponse } from "./operational-states";
import { settingsStateResponse } from "./settings-state";

/** Called only after the route's unchanged harness/secret/real-database gate. */
export async function troubleVariantResponse(request: Request, db: AppDb) {
  return (
    (await fiveDivePrintResponse(request, db)) ??
    (await futureCrewStateResponse(request, db)) ??
    (await authStateResponse(request, db)) ??
    (await mixedDepthStateResponse(request, db)) ??
    (await mixedTrainingStateResponse(request, db)) ??
    (await settingsStateResponse(request, db)) ??
    (await operationalStateResponse(request, db))
  );
}
