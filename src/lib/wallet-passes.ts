/** Departure-pass snapshots contain only facts a diver may show to somebody else. */
export type WalletPlatform = "apple" | "google";
export type PassField = { key: string; label: string; value: string };
export type PassContent = {
  shopName: string;
  description: string;
  headerFields: PassField[];
  primaryFields: PassField[];
  secondaryFields: PassField[];
  auxiliaryFields: PassField[];
  backFields: PassField[];
  relevantDate: string;
  expirationDate: string;
  backgroundColor: string;
  foregroundColor: string;
  hexBackgroundColor: string;
  voided: boolean;
};
