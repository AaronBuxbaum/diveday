# H-70: Where the device already knows a thing, may DiveDay use it?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**Where the device already knows a thing, may DiveDay use it?** The second look at the 2026-09-07 brief ([canvas](../../design/canvases/20260907-in-your-hands/README.md), ADR [20260907-in-your-hands](../../architecture/decisions/20260907-in-your-hands.md)) read the app against what Apple's features are — the device using a fact it already holds — and found five gaps: the door asks for a password on a phone that knows its owner's face, a diver at the counter with no waiver is sent a link or handed paper, a certification card is photographed and then typed, the type ignores the phone's own text setting, and the app can be installed and never says so. The ADR proposes one rule (the device already knows it; it says where it came from; the last tap is a person's; the safety floor is untouched) on five moves. Two of the five move on the ADR alone; three carry a call.

## Minimum outcome to record

**(a)** Whether staff may sign in with a passkey (Better Auth's passkey plugin, a new runtime dependency), and whether a passkey made with the device's own check stands as the fresh factor the step-up asks for before money and exports. Recommended yes to both. **(b)** Whether a diver may sign the release on the shop's own device at the counter, with the counter, the device, who handed it over and when recorded on the signature. The words stay H-01's and the typed-name standard H-03's; this is the device. Recommended yes, provenance recorded. **(c)** Whether a card photo may be sent to Amazon Textract, in the region the shop's records already live in, to fill the four certification fields as *Read* values a staffer confirms. Recommended yes, with the account's AI-services opt-out set, nothing retained, and one disclosure sentence on `/privacy`.

## Unblocks / follow-up

**Decided 2026-09-07 (Aaron Buxbaum, in session):** **(a)** yes to both — staff may sign in with a passkey, and a passkey made with the device's own check stands as the step-up's fresh factor. **(b)** yes — the release may be signed on the shop's device at the counter, with the counter, the device, who handed it over and when recorded on the signature. **(c)** declined: "we should have no photo upload" — and the question was mis-premised, since a card has carried no photograph since ADR 20260811-retire-the-digital-card; nothing on the certification form changes and no capture is added. The ADR is Accepted with those decisions; slices 19a, 19b, 19d and 19e in the roadmap, 19c dropped.

Part of the [human decision log](README.md#decision-register).
