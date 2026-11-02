/**
 * **Whether a Today row is a job of its own**: a batched row acts on divers
 * already counted (`batch`), so it is not one more. Structural on purpose, so
 * the weekly digest and the trip pulse count the way the queue does without
 * importing the queue.
 */
export function countsAsJob(action: { batch?: unknown }): boolean {
  return !action.batch;
}
