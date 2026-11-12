/** Correctness capability fence, separate from authorization and encrypted record format. */
export const ROLL_CALL_CAUSAL_PROTOCOL_HEADER = "x-diveday-roll-call-protocol";
export const ROLL_CALL_CAUSAL_PROTOCOL = "1";

export const ROLL_CALL_CAUSAL_HEADERS = {
  [ROLL_CALL_CAUSAL_PROTOCOL_HEADER]: ROLL_CALL_CAUSAL_PROTOCOL,
};

export function supportsCausalRollCall(request: Pick<Request, "headers"> | undefined): boolean {
  return request?.headers.get(ROLL_CALL_CAUSAL_PROTOCOL_HEADER) === ROLL_CALL_CAUSAL_PROTOCOL;
}
