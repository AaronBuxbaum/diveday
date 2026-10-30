// Keep the trusted OIDC publisher's config choice fixed in reviewed code. The
// caller may select the OIDC variant by mode, but cannot provide a path that
// would make reg-suit load PR-controlled configuration.
export function regSuitConfigArgs(mode) {
  if (mode === undefined || mode === "" || mode === "legacy") return [];
  if (mode === "oidc") return ["--config", "regconfig.oidc.json"];
  throw new Error('REG_SUIT_CONFIG must be "legacy" or "oidc"');
}
