/** Teardown owns only this test's virtual authenticator, never a real device credential. */
export async function closePasskeyAuthenticator(
  page: { isClosed(): boolean },
  cdp: {
    send(
      method: "WebAuthn.removeVirtualAuthenticator",
      params: { authenticatorId: string },
    ): Promise<unknown>;
    detach(): Promise<unknown>;
  },
  authenticatorId: string,
) {
  const closedTarget = (error: unknown) =>
    error instanceof Error &&
    error.message.includes("Target page, context or browser has been closed");
  if (page.isClosed()) return;
  try {
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  } catch (error) {
    if (page.isClosed() || closedTarget(error)) return;
    throw error;
  }
  if (page.isClosed()) return;
  try {
    await cdp.detach();
  } catch (error) {
    if (!page.isClosed() && !closedTarget(error)) throw error;
  }
}
