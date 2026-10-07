# what-would-warren-say

A Cloudflare Workers site: a reading companion for *Warren Buffett and the
Interpretation of Financial Statements* by Mary Buffett and David Clark,
styled like a financial newspaper. Three views sit under the masthead.

**Chapters.** A section dropdown narrows the book to one part, a row of
numbered tabs picks the chapter, and the contents page lists every chapter in
two columns. Each chapter has a chapter type, a summary box and a notes box
that save as you type. Export writes everything you have written to a JSON
file, and Import reads one back, so you can carry on another day or on another
device.

**Numbers.** Give it a ticker and your own EODHD API token and it fetches the
company's fundamentals and lays out the full yearly history of the figures the
book walks through: every statement line with the chapter beside it, and the
book's ratios with its rule of thumb under each. Fetched companies are kept
on the device, the table downloads as CSV, and an expandable section lists
every field EODHD reported.

**Watchlists.** Named lists of companies, each company with its EODHD ticker:
a generic list and a set of custom lists come filled in, and lists can be
made, renamed, added to, trimmed and deleted. A company's name opens its
numbers, and a fetched company can be added to a list from the Numbers page.

There is no build step. The files in `public/` are the site, and the page is a
single self-contained HTML file with its styles and script inline. The only
other files it loads are its own fonts. A tiny Worker, `src/worker.js`, relays
the page's EODHD requests on the same origin; everything else is served as a
static asset by that Worker's assets binding.

## Structure

```
public/
  index.html       all three views: contents, dropdown, chapter tabs, chapter pages, numbers, watchlists (one file, hash routes)
  404.html         not-found page in the same style, links back home
  favicon.svg
  robots.txt
  _headers         security and caching headers
  assets/fonts/    Playfair Display and Newsreader, latin subsets, self-hosted
src/worker.js      the EODHD relay; every other request goes to the assets
wrangler.jsonc     Worker + assets config
package.json       wrangler as a devDependency, dev/deploy/check scripts
prompt text/       the prompt and reply behind the version in service
CLAUDE.md          standing policy for working in this repo
```

## How the page works

- `#` shows the contents; `#intro` and `#1` to `#57` show a chapter page. The
  section dropdown and the tab row follow whichever chapter is open, and the
  dropdown remembers the last chapter visited in each section.
- `#numbers` shows the Numbers view, `#numbers/KO.US` a kept company (or the
  form filled in, if that company has not been fetched yet).
- `#watchlists` shows the list opened most recently, `#watchlists/chips` a
  list by its id. Lists are kept under `wwws.watchlists.v1`; until that key
  exists the page shows the starting lists built into it, and "Restore the
  starting lists" brings a deleted one back.
- Each chapter page starts with a chapter type, one of three: Overview for a
  chapter that introduces a run of chapters, Metric for one with direct
  information on a single metric, or Background for information only, such as
  the Introduction. The choice shows as a tag beside the chapter in the contents.
- What you type is saved in the browser's local storage under the key
  `wwws.entries.v1`, one entry per chapter with `summary`, `notes`, `type`
  (`overview`, `metric`, `background` or empty) and an `updated` timestamp.
  Nothing is sent anywhere.
- Export downloads `what-would-warren-say-YYYY-MM-DD.json`. Import reads such
  a file and merges it in: a chapter from the file replaces the one here unless
  the one here was written more recently, and chapters absent from the file are
  left alone. Watchlists travel in the same file and merge the same way: a
  list from the file replaces the one here unless the one here was changed
  more recently. The export holds notes and watchlists only: no company
  numbers, no API token.

## The Numbers view and EODHD

- The page calls `/api/eodhd/fundamentals/<SYMBOL>` on its own origin with the
  token in an `X-Api-Token` header. The Worker forwards that to
  `https://eodhd.com/api/fundamentals/<SYMBOL>?api_token=…&fmt=json` and passes
  the reply and its status straight back. Nothing is cached or logged there,
  only that one path is forwarded, and the Worker holds no secret of its own.
- Symbols take EODHD's form, `CODE.EXCHANGE` (`KO.US`, `VOD.LSE`); a bare US
  code gets `.US`. One fetch is ten EODHD API calls, so companies are kept on
  the device under `wwws.numbers.v1` (the eight most recent) and shown again
  without a call. The token is kept under `wwws.eodhd.token` only when
  "Remember" is ticked.
- The table runs newest first, the latest year at the left, and runs the
  full length of the page: the year headings stay pinned at the top of the
  window as you scroll down, the line names at the left as you scroll
  across, and a sideways scrollbar sits at the foot of the window for as
  long as the table is in view.
- Each fetch also keeps the last forty quarters. Click a year heading and its
  quarters unfold beside it; a "to date" column holds the quarters reported
  since the last year end. In quarter columns the four ratios built on a full
  year's earnings (return on assets, years to clear long-term debt, return on
  equity, capital expenditure against earnings) use the trailing four quarters
  and show a dash until four are available. Companies fetched before quarters
  were kept need fetching again. The CSV follows the columns on show.
- Each line tries the EODHD field names in turn (for example
  `cashAndEquivalents` then `cash`) and shows a dash when none carries a
  number. "Every field EODHD reports" lists the raw statements, so a line that
  maps badly can still be read from there. The mapping lives in `NUMBER_ROWS`
  in `index.html`.
- Opened straight from disk (`file://`) there is no Worker, so the page calls
  EODHD directly with the token as a query parameter; that only works if the
  browser allows the cross-site call.

## Local development

```bash
npm install
npm run dev          # serves public/ with wrangler dev
```

## Verification before a release

```bash
npm run check                         # wrangler deploy --dry-run
```

Then serve `public/`, render it with headless Chromium at desktop and mobile
widths, and look at the screenshots. For changes to the script, also drive the
page in a headless browser: type into a chapter, reload, export, clear
storage, import, and check the text comes back; for the Numbers view, answer
the relay path from a fixture shaped like an EODHD reply and check the table.
For a change to the Worker, run `npx wrangler dev --var EODHD_BASE:<mock url>`
against a local mock of EODHD and exercise `/api/eodhd/…` and the assets.

## Pulling whole exchanges

`tools/pull-fundamentals.mjs` pulls every company's fundamentals for a set of
exchanges from EODHD on your own machine, apart from the site, into a local
`data/` folder that git ignores. It needs Node 18 or later and nothing else:

```bash
EODHD_TOKEN=your-token npm run pull                      # NASDAQ and NYSE, London, Shanghai, Shenzhen
EODHD_TOKEN=your-token npm run pull -- --exchanges US,LSE --refresh 30
```

Each company costs ten EODHD calls and each symbol list one, so the four
exchanges, around thirteen thousand companies, take two days of a 100,000-call
allowance: the run stops on its own when the day's calls are spent and carries
on where it was when run again. It keeps EODHD's raw reply for each company,
gzipped, writes the company in the shape the Numbers page keeps, one row of
the book's ratios for the latest year, and a screen file per venue. The
options are listed at the top of the script. The token comes from the
environment and never enters the repository or the site. Nothing on the site
reads the pull yet; EODHD's personal plans do not allow the data to be
redistributed, so whatever the site later serves from it must be gated to you.

## Deployment

The repository is connected to Cloudflare Workers Builds, so every push to
`main` deploys to production. Connect it once in the Cloudflare dashboard
(Workers & Pages, Create, Import a repository) if that has not been done yet.
The Worker needs no secrets or bindings beyond what `wrangler.jsonc` declares.

## Fonts

Headlines are set in Playfair Display (Claus Eggers Sørensen) and text in
Newsreader (Production Type). Both are published under the SIL Open Font
License 1.1 and are served from `public/assets/fonts/` as latin-subset woff2
files taken from Google Fonts, so the page makes no request to Google at all.
A notice beside them carries the copyright lines and the licence link,
and each file carries the same in its own metadata.

## External resources

The page itself loads nothing from other domains. The Numbers view calls
EODHD through the site's own relay, and only when you press Fetch.
