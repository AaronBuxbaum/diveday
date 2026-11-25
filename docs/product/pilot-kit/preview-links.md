# Preview links

A demo shop built for one prospect, in their name, main color, and town, with their boats' names and the times their boats leave, and a link that opens it for a week. Decision and design: ADRs [20261116-demo-previews](../../architecture/decisions/20261116-demo-previews.md) and [20261125-previews-wear-the-prospects-day](../../architecture/decisions/20261125-previews-wear-the-prospects-day.md).

## Build one

Run this where the production database connection is set, the same way `pnpm billing:free-term` runs:

```sh
pnpm preview build https://their-site.example
```

The command reads the shop's home page and up to four of its schedule, charter, or boat pages, and prints what it found: the name, color, and town, the times the boats leave, and the boats' names. Then it prints the link. Anything it got wrong can be given by hand, and `none` skips reading a site:

```sh
pnpm preview build none --name "Reef Line Divers" --color "#0a5c8f" --town "Islamorada" --region "FL" --times "8:30 AM, 1:00 PM" --boats "Reef Runner, Sea Hunter"
```

`--times none` or `--boats none` keeps the sample day's times or boat names when the reader found something wrong and you have nothing better.

The demo's upcoming day boats move to the nearest of the shop's times on the same day, as long as that time is no more than three hours away. The dawn boat, the sunset and night dives, courses, and a boat already checking people in keep the sample's hours. The demo has two boats, so it wears the first two names. It keeps its sample divers and bookings. No logo or photograph of theirs is copied.

Open the link yourself before sending it, in a browser marked as yours (`/api/demo/quiet`), so your look is not counted.

## Build several at once

Write one shop per line, the way you would after `pnpm preview build`. Blank lines and lines starting with `#` are skipped:

```text
# Upper Keys
horizondivers.com
seadwellers.com --boats "Sea Dweller III, Ocean Dweller"
none --name "Reef Line Divers" --town "Islamorada" --region "FL" --times "8:30 AM, 1:00 PM"
```

```sh
pnpm preview batch shops.txt
```

Every line is checked before anything is built, so one typo builds nothing. Then each shop is built in turn, and the links are printed together at the end beside the shops' names. Keep the file out of the repository: it names prospects.

## Send it

The link goes in the cold email in place of `https://www.dive.day`, and in the day-10 Facebook or Instagram message ([the rhythm](cold-email-template.md#the-rhythm-four-touches-then-stop)). Say what it is in one sentence, for example: "I built a preview of DiveDay with your shop's name on it, and it stays open for a week." Nothing is emailed by the command.

## Read what happened

```sh
pnpm preview list
```

Each preview shows three numbers:

| Number | What it means |
| --- | --- |
| requested | The link's page was fetched. Mail scanners fetch every link, so this alone means nothing. |
| opened | A browser ran the page and entered the shop. |
| used | Somebody typed or tapped inside the shop. This is a person. |

The first time a preview is used, the alert inbox gets "Preview in use: <shop>" with the other two numbers beside it.

## When it ends

After seven days the link says the preview has ended and asks the reader to reply to the email. Build a new one to reopen it. The record of who looked is kept after the demo shop is deleted.
