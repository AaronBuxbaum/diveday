/** Capability only, never evidence that this account has a credential on the device. */
export function browserSupportsPasskeys(browser: {
  isSecureContext: boolean;
  PublicKeyCredential?: unknown;
  location: { hostname: string };
}): boolean {
  const host = browser.location.hostname;
  return (
    browser.isSecureContext &&
    Boolean(browser.PublicKeyCredential) &&
    !/^[\d.]+$/.test(host) &&
    !host.includes(":")
  );
}
