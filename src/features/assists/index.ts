/** Shared assist execution and its deterministic provider adapter. */
export {
  armClaudeFixtures,
  claudeFixturesArmed,
  e2eClaudeFixtureProvider,
  e2eFixturesAllowed,
  fixtureMessage,
} from "./e2e-fixtures";
export { FRONT_FIXTURES } from "./front-fixtures";
export type { AssistEnvironment, AssistOptions, AssistOutcome, RunAssistInput } from "./store";
export {
  assistDarkReasonFor,
  assistsAvailable,
  claudeSpendUsdBetween,
  demoClaudeSpendMicroUsd,
  IN_FLIGHT_WINDOW_MS,
  MAX_CALLS_IN_FLIGHT,
  reservedMicroUsd,
  runAssist,
  runAssistOutcome,
  shopClaudeSpendMicroUsd,
} from "./store";
