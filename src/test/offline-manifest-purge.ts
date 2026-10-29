import {
  beginOfflineTenantVerificationRound,
  purgeOfflineManifestsExceptShop,
} from "@/lib/offline-manifest-store";

export async function purgeAsVerifiedShop(shopSlug: string) {
  return purgeOfflineManifestsExceptShop(shopSlug, await beginOfflineTenantVerificationRound());
}
