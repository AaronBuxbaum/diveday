import { expect, it } from "vitest";
import { manifestHistoryCookieName, readManifestHistoryCookie } from "./manifest-history-cookie";

const trip = "11111111-1111-4111-8111-111111111111";
const nonce = "22222222-2222-4222-8222-222222222222";

it("reads only one well-formed nonce for the exact trip", () => {
  const name = manifestHistoryCookieName(trip);
  expect(readManifestHistoryCookie(`other=x; ${name}=${nonce}`, trip)).toBe(nonce);
  expect(readManifestHistoryCookie(`${name}=${nonce}; ${name}=${nonce}`, trip)).toBeUndefined();
  expect(readManifestHistoryCookie(`${name}=not-a-nonce`, trip)).toBeUndefined();
  expect(
    readManifestHistoryCookie(`${name}=${nonce}`, "33333333-3333-4333-8333-333333333333"),
  ).toBeUndefined();
});
