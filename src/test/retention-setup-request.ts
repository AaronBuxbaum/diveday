export const setupRequestForRetention = (shopName: string, createdAt: Date) => ({
  shopName,
  region: "Key Largo",
  runsBoat: true,
  currentSystem: "paper",
  contactName: "Retention Lead",
  email: `${shopName.toLowerCase().replace(/\s+/g, "-")}@example.invalid`,
  source: "retention-test",
  locale: "en-US",
  createdAt,
  receiptStatus: "accepted" as const,
  receiptClaimedAt: createdAt,
  receiptProviderMessageId: "ses-retention",
});
