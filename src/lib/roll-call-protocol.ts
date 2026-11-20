/** Correctness capability fence, separate from authorization and encrypted record format. */
export const ROLL_CALL_CAUSAL_PROTOCOL_HEADER = "x-diveday-roll-call-protocol";
export const ROLL_CALL_CAUSAL_PROTOCOL = "1";
export const ROLL_CALL_WITNESS_PROTOCOL = "3";

export const ROLL_CALL_CAUSAL_HEADERS = {
  [ROLL_CALL_CAUSAL_PROTOCOL_HEADER]: ROLL_CALL_CAUSAL_PROTOCOL,
};

export const ROLL_CALL_WITNESS_HEADERS = {
  [ROLL_CALL_CAUSAL_PROTOCOL_HEADER]: ROLL_CALL_WITNESS_PROTOCOL,
};

export function supportsRollCallWitness(request: Pick<Request, "headers"> | undefined): boolean {
  return request?.headers.get(ROLL_CALL_CAUSAL_PROTOCOL_HEADER) === ROLL_CALL_WITNESS_PROTOCOL;
}

export function supportsCausalRollCall(request: Pick<Request, "headers"> | undefined): boolean {
  return request?.headers.get(ROLL_CALL_CAUSAL_PROTOCOL_HEADER) === ROLL_CALL_CAUSAL_PROTOCOL;
}
