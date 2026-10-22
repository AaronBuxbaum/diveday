/** Stable translation keys for the conservative device labels on account security. */
export type SessionBrowser = "chrome" | "edge" | "firefox" | "opera" | "safari" | "samsung";
export type SessionOs = "android" | "chromeOs" | "ios" | "linux" | "macOs" | "windows";

export type SessionDeviceLabel = {
  browser: SessionBrowser | null;
  os: SessionOs | null;
};

/** Missing server identity means current-session state is unknown. */
export function isCurrentAccountSession(currentSessionId: string | undefined, rowId: string) {
  return Boolean(currentSessionId && currentSessionId === rowId);
}

/** Keep the optional raw fingerprint finite even when a client sends a huge value. */
export function sessionUserAgentDetails(userAgent: string | null | undefined) {
  return userAgent?.slice(0, 512) ?? null;
}

/**
 * Recognize only familiar browser and operating-system tokens. User-agent data
 * is untrusted and may be malformed or enormous; an unknown value stays unknown.
 */
export function sessionDeviceLabel(userAgent: string | null | undefined): SessionDeviceLabel {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject user-agent header control characters before displaying a device label.
  if (!userAgent || userAgent.length > 512 || /[\u0000-\u001f\u007f]/.test(userAgent)) {
    return { browser: null, os: null };
  }

  let browser: SessionBrowser | null = null;
  if (/(?:Edg|EdgA|EdgiOS|Edge)\//i.test(userAgent)) browser = "edge";
  else if (/(?:OPR|Opera)\//i.test(userAgent)) browser = "opera";
  else if (/SamsungBrowser\//i.test(userAgent)) browser = "samsung";
  else if (/(?:CriOS|Chrome)\//i.test(userAgent)) browser = "chrome";
  else if (/(?:Firefox|FxiOS)\//i.test(userAgent)) browser = "firefox";
  else if (/(?:Version\/[^ ]+ .*Safari|Safari)\//i.test(userAgent)) browser = "safari";

  let os: SessionOs | null = null;
  if (/Android/i.test(userAgent)) os = "android";
  else if (/(?:iPhone|iPad|iPod|Macintosh.*Mobile)/i.test(userAgent)) os = "ios";
  else if (/(?:Macintosh|Mac OS X)/i.test(userAgent)) os = "macOs";
  else if (/Windows NT/i.test(userAgent)) os = "windows";
  else if (/(?:CrOS|Chrome OS)/i.test(userAgent)) os = "chromeOs";
  else if (/Linux/i.test(userAgent)) os = "linux";

  return { browser, os };
}
