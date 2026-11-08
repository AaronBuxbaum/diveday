/** whatsapp-signup public contract. Internals are imported only within this module. */

export type {
  CompleteSignupInput,
  CourtesyTemplateCopy,
  FinishSignupInput,
  SignupExchangeResult,
  SignupStep,
  WhatsAppSignupConfig,
  WhatsAppSignupResult,
} from "./rules";
export {
  confirmNumberInWaba,
  confirmWabaAccess,
  courtesyTemplateDefinition,
  exchangeSignupCode,
  finishEmbeddedSignup,
  GRAPH_REQUEST_TIMEOUT_MS,
  generateRegistrationPin,
  whatsAppSignupConfigFromEnvironment,
} from "./rules";
export type { WhatsAppSignupDeps, WhatsAppSignupInput, WhatsAppSignupOutcome } from "./store";
export { completeWhatsAppSignup } from "./store";
