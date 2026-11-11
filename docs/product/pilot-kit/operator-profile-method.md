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
