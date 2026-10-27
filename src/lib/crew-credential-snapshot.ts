/** The credential facts seen in one live crew-boarding statement. */
export type CrewCredentialSnapshot = {
  kind: string;
  issuedAt: string | null;
  renewsAt: string | null;
};
