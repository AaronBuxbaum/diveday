/** claude public contract. Internals are imported only within this module. */

export type { AssistConditions, AssistDarkReason } from "./dark";
export {
  ASSIST_DARK_REASONS,
  assistDarkReason,
  DEFAULT_DEMO_MONTHLY_CAP_USD,
  DEFAULT_DEMO_SHOP_MONTHLY_CAP_USD,
  DEFAULT_SHOP_MONTHLY_CAP_USD,
  demoMonthlyCapMicroUsd,
  demoShopMonthlyCapMicroUsd,
  externalHttpDisabled,
  shopMonthlyCapMicroUsd,
} from "./dark";
export type { WebFetchLimits } from "./web-fetch";
export { allowedFetchHost, SHARED_SERVICE_ROOTS, webFetchTool } from "./web-fetch";
