/**
 * Visual captures: the audit states registered from `e2e/visual-audit-*.ts`.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { test } from "./fixtures";
import { registerAccountAuditCaptures } from "./visual-audit-account-states";
import { registerAdditionalAuditCaptures } from "./visual-audit-additional-states";
import { registerDepartureExpandedAuditCaptures } from "./visual-audit-departure-expanded";
import { registerDiverExpandedAuditCaptures } from "./visual-audit-diver-expanded";
import { registerErrorAuditCaptures } from "./visual-audit-error-states";
import { registerGearStaffOverlayAuditCaptures } from "./visual-audit-gear-staff-overlays";
import { registerPrintAuditCaptures } from "./visual-audit-print-states";
import { registerRemainingExpandedAuditCaptures } from "./visual-audit-remaining-expanded";
import { registerRequestPaymentOverlayAuditCaptures } from "./visual-audit-request-payment-overlays";
import { registerStaffAuditCaptures } from "./visual-audit-staff-states";
import {
  capture,
  capturePrint,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

registerAccountAuditCaptures(capture, FLOW_TIMEOUT_MS);
registerAdditionalAuditCaptures(capture);
registerDepartureExpandedAuditCaptures(capture, FLOW_TIMEOUT_MS);
registerDiverExpandedAuditCaptures(capture);
registerErrorAuditCaptures(capture);
registerGearStaffOverlayAuditCaptures(capture);
registerStaffAuditCaptures(capture, FLOW_TIMEOUT_MS);
registerPrintAuditCaptures(capturePrint);
registerRemainingExpandedAuditCaptures(capture, FLOW_TIMEOUT_MS);
registerRequestPaymentOverlayAuditCaptures(capture, FLOW_TIMEOUT_MS);
