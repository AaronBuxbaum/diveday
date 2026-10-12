/**
 * **A thrown error, reduced to words a log line or a column may hold** (issue
 * #2334). An error's message can quote whatever the failing call was handed: a
 * recipient's address, a diver's name, a driver's bound parameters. Its class
 * and a driver's own code (a SQLSTATE, `ECONNRESET`) cannot, so those are all
 * that come out of here, and only when they have the shape of one.
 */

/** A class name: an identifier, nothing a message could have been pasted into. */
const CLASS_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** A driver or system code: `23505`, `ECONNRESET`, `UND_ERR_CONNECT_TIMEOUT`. */
const CODE = /^[A-Z0-9_]{1,32}$/;

function field(value: unknown, key: "name" | "code"): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** The error's class, or `unknown_error` when it has none worth naming. */
export function errorClassToken(error: unknown): string {
  const name = error instanceof Error ? error.name : undefined;
  return name && CLASS_NAME.test(name) ? name : "unknown_error";
}

/** The `cause`'s class and code, each only when it has the shape of one. */
export function errorCauseTokens(error: unknown): { causeName?: string; causeCode?: string } {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause === undefined || cause === null) return {};
  const name = field(cause, "name");
  const code = field(cause, "code");
  return {
    ...(typeof name === "string" && CLASS_NAME.test(name) ? { causeName: name } : {}),
    ...(typeof code === "string" && CODE.test(code) ? { causeCode: code } : {}),
  };
}

/**
 * One word for a thrown error: the cause's code when it has one (it says what
 * the network or the database did), else the error's class.
 */
export function thrownErrorToken(error: unknown): string {
  return errorCauseTokens(error).causeCode ?? errorClassToken(error);
}
