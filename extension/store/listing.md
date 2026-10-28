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

For dive shops that run on DiveDay. When a staff member checks an SSI card, the extension opens SSI's page in the foreground and fills the known name and birth date. The staff member reviews SSI's terms and completes the search; the extension does not submit or read the answer. For NAUI, SDI, GUE, CMAS and PADI, the extension fills the agency's lookup in a background tab and returns the answer to DiveDay, which decides whether the card is certified. The staff member sees the answer beside the card, with an Undo.

When a check cannot read the agency's answer (its form is not where it was, the answer never comes, or a captcha on the form asks for a person), the extension may send DiveDay the page's structure (its labels, button words and headings, never anything typed into it or anyone's details) so DiveDay can fix the reader.

It does nothing on its own: it runs only when a staff member presses a check button on DiveDay's staff pages, and it reads only the agencies' lookup pages listed in its permissions. PADI's DiveChek and eLearning checks use the shop's own signed-in PADI Pros' Site in the staff member's browser; DiveDay never holds a PADI sign-in, and a shop turns those checks on for itself.

Without the extension DiveDay still links each card to its agency's lookup page. Phones do not run extensions, so this is for the front-desk computer.

Privacy: https://dive.day/privacy#extension

**Screenshots** (1280×800): see [the runbook](../../docs/engineering/cert-check-extension-runbook.md#store-screenshots). They show the demo shop's made-up divers only.

**Icon** (128×128): `icons/icon-128.png`, the one `manifest.json` names.

## Privacy practices tab

**Single purpose:**

Looks up a diver's dive certification on the certifying agency's own public or member lookup page when a DiveDay staff member asks, and returns the agency's answer to DiveDay.

**Permission justifications:**

| Permission | Justification (paste as written) |
| --- | --- |
| `scripting` | Fills in the agency's certification lookup form in the tab the extension opened, and reads the agency's answer from it, when a DiveDay staff member asks for a check. |
| `https://my.divessi.com/*` | Fills SSI's public Online Diver Check form when a DiveDay staff member asks. The staff member submits and reads it. |
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
| Personally identifiable information | Yes | What the agency's form asks for, sent only to the agency the staff member chose, to look the card up: SSI the diver's name and birth date if known; NAUI, SDI and PADI DiveChek the name and birth date; GUE the card number only; CMAS the CMAS code, or the name and birth date; PADI eLearning the course student's email only. |
| Website content | Yes | The text of automatic agency checks other than SSI is returned to the staff member's DiveDay shop to decide the check. On the PADI Pros' Site only the lines about that diver, and for eLearning only the student's own lines. When an automatic check fails, the page's structure (labels, button words, headings; never anything typed or any person's details), so DiveDay can fix the reader. |
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
