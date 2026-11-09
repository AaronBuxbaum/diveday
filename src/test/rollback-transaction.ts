const ROLLBACK = Symbol("diveday:rollback");

/** Open a callback transaction without leaving a rejected BEGIN waiting on readiness. */
export async function openRollbackTransaction<T>(
  transaction: (callback: (db: T) => Promise<void>) => Promise<unknown>,
): Promise<{ db: T; finish: () => Promise<void> }> {
  let ready: (db: T) => void = () => {};
  let rejectOpening: (error: unknown) => void = () => {};
  const opened = new Promise<T>((resolve, reject) => {
    ready = resolve;
    rejectOpening = reject;
  });
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failed = false;
  let failure: unknown;
  // Attach the rejection handler immediately, including synchronous BEGIN errors.
  const settled = Promise.resolve()
    .then(() =>
      transaction(async (db) => {
        ready(db);
        await released;
        throw ROLLBACK;
      }),
    )
    .catch((error: unknown) => {
      if (error !== ROLLBACK) {
        failed = true;
        failure = error;
        rejectOpening(error);
      }
    });
  return {
    db: await opened,
    async finish() {
      release();
      await settled;
      if (failed) throw failure;
    },
  };
}
