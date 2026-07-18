const legacySslModes = new Set(["prefer", "require", "verify-ca"]);

/**
 * Keep pg's current secure behavior explicit before pg-connection-string v3.
 * URLs opting into libpq semantics are intentionally left unchanged.
 */
export function withExplicitSslMode(connectionString: string): string {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");

  if (
    !sslMode ||
    !legacySslModes.has(sslMode) ||
    url.searchParams.get("uselibpqcompat") === "true"
  ) {
    return connectionString;
  }

  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
