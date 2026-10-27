/** A provider operation crossed the delivery's shared elapsed-time deadline. */
export class IntegrationDeliveryDeadlineError extends Error {
  constructor() {
    super("Integration delivery deadline exceeded");
    this.name = "IntegrationDeliveryDeadlineError";
  }
}

/** Keep the provider's per-request timeout and the whole-delivery deadline. */
export function combineDeliverySignals(
  deliverySignal: AbortSignal | undefined,
  requestSignal: AbortSignal,
): AbortSignal {
  return deliverySignal ? AbortSignal.any([requestSignal, deliverySignal]) : requestSignal;
}

/**
 * Race a fetch or body read against its signal. Always attach fulfillment and
 * rejection handlers to started work, even if abort fires synchronously, so a
 * non-compliant fake cannot leave an unhandled late rejection.
 */
export function untilAborted<T>(operation: () => PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new IntegrationDeliveryDeadlineError());

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new IntegrationDeliveryDeadlineError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    let pending: PromiseLike<T>;
    try {
      pending = operation();
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
      return;
    }
    Promise.resolve(pending).then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (signal.aborted) reject(new IntegrationDeliveryDeadlineError());
        else resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(signal.aborted ? new IntegrationDeliveryDeadlineError() : error);
      },
    );
  });
}

export function responseJsonWithinDeadline<T>(response: Response, signal: AbortSignal): Promise<T> {
  return untilAborted(() => response.json() as Promise<T>, signal);
}
