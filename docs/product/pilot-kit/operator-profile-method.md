# Operator profile method

How to build a batch of researched operator profiles for any region or operator type, from public pages only. It replaces buying a list. The filled profiles hold business contact details, so like the [call list](florida-call-list.md) they stay out of this repo, in the shared project files.

Nothing is sent from this process. Every email is a draft that Aaron sends by hand, following the [cold email template](cold-email-template.md).

## The prompt

> Research [N] [operator type] in [region]. Use only each operator's own public website, plus a directory page only to find the site. Read the site in a browser, not from search snippets. For each operator record: name, town, named owner or captain (only if the site names them as such), published business email and phone, boat and capacity, booking system, waiver setup, rentals and guide arrangements, and one specific handoff between booking and the boat that DiveDay speaks to. Then give why it fits, a first demo example, a subject line and a short draft email from Aaron that follows the cold email template. Add source URLs and the date read. Write "not published" for anything you did not read. Do not guess a vendor, an owner or an address. Do not contact anyone.

## Rules that keep it honest

1. **The live site beats the directory and the email.** Map listings and older pages go stale. Where two pages disagree, say which one is current and why.
2. **Read booking and waiver from the page's own links.** The booking system shows in the embed or button address (FareHarbor, Peek, TRYTN and others). Never infer it.
3. **A name counts as an owner only if the site says so.** A captain named in a guest review is not an owner.
4. **A general inbox gets the forwarding version of the email.** Only a named person gets a first-name opening.
5. **The handoff is specific and checkable**: outside rentals, a guide arranged after booking, a waiver signed in one place and checked in another, a group over six, repeat-guest gear. If none can be found, say so and use the no-detail email.
6. **Claims stay inside the [claims policy](../marketing.md#claims-policy-hard-rules).** Never call offline roll call proven.
7. **Check each email against the brand voice** ([brand.md](../../design/brand.md#voice)): plain words, no em-dashes, no filler intensifiers.

## Columns

batch, operator, location, named_people, email_published, phone, boat_and_capacity, booking_system, waiver_setup, handoff, why_it_fits, first_demo, suggested_subject, verified_on, source_urls, status.

## Order of work

1. Pull candidates from the last research file. Re-read each live site; do not copy forward.
2. If a vendor list is the input, check each name first: is it real, in the right region, and open?
3. Write the profile, then the draft. Mark what was not re-read.
4. Save the markdown and CSV to the shared project files folder, not the repo.

## Running it with Claude, start to finish

The vendor's service is a research pass plus a drafting pass. Claude can do both. Run it in a Claude Code session with the browser, one region and one operator type per run, about ten operators, and read every draft before sending.

**Paste this:**

> Find ten [operator type, e.g. six-passenger dive charters] in [region] that could be good first customers for DiveDay, and draft an opening email for each. Read [docs/product/pilot-kit/operator-profile-method.md] and [docs/product/pilot-kit/cold-email-template.md] first.
>
> Step 1, find. Search the web, and directories such as scubaschedules.com, Guidesly and the shop's own Google listing, for candidates. Keep only operators that are open, run their own boat, and publish a business email or a named person. Discard shops where retail is the whole business.
>
> Step 2, read. Open each candidate's own site in the browser. Record the fields in the method. Find the booking system from the booking button's address. Find one specific handoff between a booking and the boat: gear or rentals arranged elsewhere, a guide arranged after booking, a waiver signed in one place and checked in another, a group over six, a returning guest's gear. Write "not published" for anything you did not read.
>
> Step 3, rank. Score fit from what you read: one person you can write to, a small boat or a clear handoff, a gap DiveDay closes. Give the top five a draft.
>
> Step 4, draft. Use the hybrid email below. The question must come from the handoff you found. Never name a competitor's product. Never claim anything about DiveDay that is not shipped.
>
> Step 5, hand over. Save a markdown file and a CSV to the project files folder. Do not send anything and do not contact anyone.

## The hybrid email

It keeps what works in Aaron's current email (he is a diver and an engineer, he has never run a shop, he needs a real boat to test on, "either answer helps") and drops what reads as selling: naming the shop's booking tool as a competitor to beat, "cheaper and more beautiful", three asks in one email and a long explanation of the product. The trial is the one ask, and the shop's own handoff is the question.

**Subject:** the hour before the boat leaves (no shop name in the subject)

> [First name],
>
> I'm a diver and a software engineer, and I've spent a while building a tool for running dive days, from booking through the head count on the boat. I've never run a shop, which is why I'm writing to you and not selling anything.
>
> Most of what I know came from one owner showing me his system, a spreadsheet and a whiteboard. [ONE QUESTION FROM THE HANDOFF, for example: Your site has guests sign the waiver online but check in at the shop. When two people in a group of eight haven't signed, what does that morning look like?]
>
> The part I can't test from my apartment is the boat. Divers get counted between dives with the radio off, but it has never been on a rocking deck with wet hands, and I won't say it holds until someone has tried it there.
>
> So I'm looking for one shop willing to try it for a few months and tell me where it breaks. I'd gladly fly in, dive, and set it up myself. First, though: is that morning a real problem for you, or am I describing one you don't have? Either answer helps.
>
> If the boat side is someone else's call, I'd be glad to be pointed their way.
>
> Aaron Buxbaum
> [CELL]
> dive.day

Notes for sending: if nothing about the handoff could be read on the shop's pages, use the template's no-detail question. Keep the offline sentence as written; it matches the [claims policy](../marketing.md#claims-policy-hard-rules). Naming the shop's booking tool is left out on purpose, but it can come back in the reply once they ask. "Free" is not in the draft because pricing for a trial is Aaron's call.
