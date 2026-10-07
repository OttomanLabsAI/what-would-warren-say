# what-would-warren-say

A Cloudflare Workers site: a reading companion for *Warren Buffett and the
Interpretation of Financial Statements* by Mary Buffett and David Clark,
styled like a financial newspaper. Two views sit under the masthead.

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

There is no build step. The files in `public/` are the site, and the page is a
single self-contained HTML file with its styles and script inline. The only
other files it loads are its own fonts. A tiny Worker, `src/worker.js`, relays
the page's EODHD requests on the same origin; everything else is served as a
static asset by that Worker's assets binding.

## Structure

```
public/
  index.html       both views: contents, dropdown, chapter tabs, chapter pages, numbers (one file, hash routes)
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
  left alone. The export holds notes only: no company numbers, no API token.

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
