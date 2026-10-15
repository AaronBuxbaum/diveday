# Chrome Web Store listing: DiveDay certification check

What to paste into the Chrome Web Store developer dashboard (and Edge Add-ons, which takes the same
zip and the same words) for the extension in this folder. `scripts/pack-extension.mjs` leaves this
folder out of the zip. Publishing is Aaron's (#2253); the steps are in
[the runbook](../../docs/engineering/cert-check-extension-runbook.md#publishing). Every claim here
is readable off `extension/` and `src/lib/agency-check.ts`; change this file in the same change as
anything it describes.

Each field below is one line, so it pastes without hard breaks.

## Store listing tab

**Name** (from `manifest.json`): DiveDay certification check

**Summary** (132 characters at most; this is 117):

Checks a diver's certification on their agency's own lookup page, from DiveDay, when a dive shop's staff member asks.

**Category:** Productivity, Workflow & Planning

**Language:** English

**Description:**

For dive shops that run on DiveDay. When a staff member presses "Check with SSI" (or NAUI, SDI, GUE, CMAS or PADI) on a diver's card in DiveDay, this extension opens that agency's own certification lookup page in a background tab, fills in the diver's name and the one detail the agency's form asks for, reads the answer and hands it back to DiveDay, which decides whether the card is certified. The staff member sees the answer beside the card, with an Undo.

It does nothing on its own: it runs only when a staff member presses a check button on DiveDay's staff pages, and it reads only the agencies' lookup pages listed in its permissions. PADI's DiveChek and eLearning checks use the shop's own signed-in PADI Pros' Site in the staff member's browser; DiveDay never holds a PADI sign-in, and a shop turns those checks on for itself.

Without the extension DiveDay still links each card to its agency's lookup page. Phones do not run extensions, so this is for the front-desk computer.

Privacy: https://dive.day/privacy#extension

**Screenshots** (1280×800): see [the runbook](../../docs/engineering/cert-check-extension-runbook.md#store-screenshots). They show the demo shop's made-up divers only.

**Icon** (128×128): not drawn yet. `manifest.json` carries no `icons` entry, and the store needs one; see the runbook.

## Privacy practices tab

**Single purpose:**

Looks up a diver's dive certification on the certifying agency's own public or member lookup page when a DiveDay staff member asks, and returns the agency's answer to DiveDay.

**Permission justifications:**

| Permission | Justification (paste as written) |
| --- | --- |
| `scripting` | Fills in the agency's certification lookup form in the tab the extension opened, and reads the agency's answer from it, when a DiveDay staff member asks for a check. |
| `https://my.divessi.com/*` | Fills in SSI's public Online Diver Check form when a DiveDay staff member asks, and reads the answer. |
| `https://www.naui.org/*` | Fills in NAUI's public certification lookup form when a DiveDay staff member asks, and reads the answer. |
| `https://www.tdisdi.com/*` | Fills in SDI's public certification search form when a DiveDay staff member asks, and reads the answer. |
| `https://www.gue.com/*` | Fills in GUE's public card verification form when a DiveDay staff member asks, and reads the answer. |
| `https://portal.cmas.org/*` | Fills in the CMAS certification search form when a DiveDay staff member asks, and reads the answer. |
| `https://pro.padi.com/*` | Fills in PADI's DiveChek and eLearning search on the PADI Pros' Site the staff member is already signed in to, when they ask, and reads only the lines about that diver. |
| `https://pros.padi.com/*` | PADI's other Pros' Site address, which PADI may send the same tab to; used only as `https://pro.padi.com/*` is. |
| Content script on `https://dive.day/shop/*` | Shows DiveDay's staff pages that the extension is installed and carries a staff member's check request to the extension. It runs on no other site. |

**Remote code:** No. Every script is in the package; nothing is fetched and run.

**Data usage** (the dashboard's checkboxes):

| Category | Collected? | What and why |
| --- | --- | --- |
| Personally identifiable information | Yes | The diver's name, and a birth date or card number (a course student's email for PADI eLearning), sent only to the agency the staff member chose, to look the card up. |
| Website content | Yes | The text of the agency's answer page, returned to the staff member's DiveDay shop to decide the check. On the PADI Pros' Site only the lines about that diver. |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | No | It never reads or stores a password or a sign-in. |
| Personal communications | No | |
| Location | No | |
| Web history | No | |
| User activity | No | |

**Certifications** (tick all three): the data is not sold or transferred to third parties outside the approved use; it is not used or transferred for purposes unrelated to the single purpose; it is not used or transferred to determine creditworthiness or for lending.

**Privacy policy URL:** https://dive.day/privacy#extension

## Distribution

**Visibility:** Unlisted until the first pilot shop has run the checks (the runbook's exit criteria), then Public. An unlisted item installs from its link, which is what DiveDay's Settings shows once `EXTENSION_STORE_URL` holds it.

**Regions:** all.
