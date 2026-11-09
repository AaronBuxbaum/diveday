/** Never continue against a half-reset shop, or leak its response body into CI. */
export function assertDemoReset(
  response: { ok(): boolean; status(): number },
  phase: string,
): void {
  if (!response.ok()) {
    throw new Error(
      `${phase}: POST /api/test/reset returned ${response.status()}. Check resetDemoSchedule's delete ordering in src/db/seed.ts.`,
    );
  }
}
