# CLAUDE.md

Standing policy for this repository. Read it before making any change here.

## What this repo is

A Cloudflare Workers site: static assets in `public/` plus one small Worker,
`src/worker.js`, that relays the page's EODHD requests on the same origin and
hands every other request to the assets binding. There is no build step - the
files in `public/` are the site. The repo is connected to Cloudflare Workers
Builds, so **every push to `main` deploys to production**.

```
public/            everything served as assets
  index.html       all three views (companies, watchlists, contents, dropdown, chapter tabs, chapter pages): one file
  data/            sample data: index.json + companies/<SYMBOL>.json, from tools/bundle-samples.mjs (git-tracked, EODHD-derived)
  404.html         same masthead and palette as index.html
  favicon.svg
  _headers         security + caching headers
  robots.txt
  assets/fonts/    Playfair Display + Newsreader woff2 (OFL), the only assets
src/worker.js      /api/eodhd/{fundamentals,real-time,eod,intraday}/<symbol> -> eodhd.com; everything else -> env.ASSETS
wrangler.jsonc     main + assets (binding ASSETS, 404-page) + EODHD_BASE var
package.json       wrangler devDependency + dev/deploy/check/pull scripts
tools/lib/pull.mjs  the pull engine: lists, fetches, extracts, screens; mirrors the page's extraction
tools/pull-fundamentals.mjs  the command line over the engine: whole exchanges into data/, apart from the site
tools/pull-app.mjs  a local page over the engine: market or sample-watchlist dropdowns, Start, Stop, calls spent
tools/bundle-samples.mjs  copies a pull's companies into public/data/ as the site's sample data
data/              the pull's output: git-ignored, EODHD-licensed, never committed
prompt text/       the records behind the version in service (see below)
```

## How the page works

`index.html` is a single file with its styles and script inline. The site
opens on the Companies view: `#` and `#companies` (and `#numbers`, the old
name, kept as an alias) show it, `#companies/<SYMBOL>` a company. Chapters
are at `#chapters` (the contents), `#intro`, `#1` to `#57`; a section dropdown whose change opens
that section's first chapter (or the last one visited there), a tab row of
chapter numbers for the open section, a chapter-type choice (Overview,
Metric or Background, stored as `type`: `overview`, `metric`, `background` or
empty), a summary box and a notes box per chapter, autosave to local storage
under `wwws.entries.v1`, and Export/Import of a JSON file named
`what-would-warren-say-YYYY-MM-DD.json`. An entry is kept while it has text or
a type; "written" (the tab dot, the contents count) means text. Import merges:
a chapter from the file replaces the one here unless the one here is newer,
and chapters absent from the file are left alone; an unknown `type` is dropped.
The storage key and the export shape are a contract with existing exports:
add fields, never rename or remove them, and change them only with a migration.

The Companies view (the tab is labelled Companies; the code still calls it
numbers: `renderNumbers`, `view-numbers`, `wwws.numbers.v1`) fetches EODHD
fundamentals through the relay with the reader's own token in an `X-Api-Token` header,
keeps the extracted company under `wwws.numbers.v1` (eight most recent; yearly
statements plus the last `MAX_QUARTERS` = 40 quarters as `incomeQ`, `balanceQ`,
`cashflowQ`, `sharesQ`, `epsQ`) and the token under `wwws.eodhd.token` only
when "remember" is ticked. The table runs the full length of the page inside
a `.table-frame`: the `.table-wrap` scrolls sideways with its own scrollbar
hidden, the `.table-bar` under it mirrors that scroll and sticks to the foot
of the window while the table is in view (`bindFrames` wires the two and
sizes the bar), the `.item` cells are sticky to the left, and the heading
cells are shifted down with a transform as the page scrolls so they stay at
the top of the window, which sticky positioning cannot do from inside a
sideways scroller (`border-collapse: separate` so the sticky borders hold).
Do not put the table back in a box that scrolls on its own. Columns run
newest first: the "to
date" column, then each year with its quarters, newest first, to its right. A
year heading with quarters is a `button.yr`; `columnsFor` builds the columns,
`quarterData` the quarter values, and rows flagged `annual: true` use
`trailingFour` sums in quarter columns. A "to date" column (`date: 'todate'`)
carries quarters after the last year end. A company also keeps `next`, the
earliest report still to come from EODHD's `Earnings.History` (`date`,
`quarter`, `when`, `estimate`, or `null`; `nextReport` finds it), shown under
the headline by `nextReportHtml`; a company kept before `next` existed shows
a "fetch again" line. Every line of the table carries a `button.graph`
(`data-row` is its index in `NUMBER_ROWS`) that opens one `<dialog
class="graph-dialog">`, built once by `ensureGraphDialog`: `graphPeriods` and
`graphValues` give the series (yearly, or quarterly through `quarterData` so
`annual: true` rows use the trailing four quarters), `graphStats` the
figures (mean, median, sample variance and deviation, coefficient of
variation, low, high, least-squares slope and R² on the period index,
change, compound growth a year, falls and the largest fall), `chartSvg` draws
the inline SVG (grid, axis, line or bar marks, the optional trend line or
mean band, the last value labelled, hit bands for the hover readout) and
`figuresHtml` the list under it. The window presets set the from-to range to
the last 5 or 10 years (times four for quarters) and a hand-set range turns
the window back to "shown". No chart library: the page still loads nothing
from elsewhere. The export
file never carries numbers or the token. `NUMBER_ROWS` in `index.html` maps
the book's lines to EODHD field names, several candidates per line, with the
chapter and the book's rule of thumb; "Every field EODHD reports" shows the
raw statements. Sample data: `public/data/index.json` lists companies the
owner pulled and `public/data/companies/<SYMBOL>.json` holds each in the
page's shape (`tools/bundle-samples.mjs` writes both from `data/`); the page
loads the index at boot (`loadSamples`), opens a company's file on first view
(`loadSample`, kept for the session with `sample: true`), and a kept copy
takes precedence over the sample. A sample company's page says "Sample data
pulled", offers "Fetch a live copy" and has no Forget. The company page
carries no "also kept" line and no units paragraph: the owner had them
removed. The relay forwards only `fundamentals/<symbol>`, `real-time/<symbol>`,
`eod/<symbol>` and `intraday/<symbol>` on GET (`ALLOWED`), passes on only the
query parameters in `PASS` (`from`, `to`, `period`, `interval`, `order`) when
they match their shapes, holds no secret, caches nothing, and passes EODHD's
status and body straight back.

Under the next-report line the company page carries a price line
(`priceHtml`, `wirePrice`): once a token is in the box it fetches
`real-time/<symbol>` (one call), shows the price, the day's change and the
quote time, and keeps the quote in memory for `QUOTE_LIFE` (fifteen minutes);
without a token it says so and offers a button. Its Graph link opens a second
dialog (`ensurePriceDialog`, `openPriceGraph`, `drawPrice`) with the spans in
`SPANS`: 1D is `intraday/<symbol>` at five-minute bars over the last five
days, reduced to the last trading day (five calls); 1W, 1M, 6M and 1Y are
`eod/<symbol>` by day, 5Y and 10Y by week, All time by month from 1900 (one
call each). `spanRequest` builds the request, `pricePoints` the points, and
each span is cached in `priceSeries` for the session. The chart is
`chartSvg` with unit `price`: a line, no dots, and the axis fitted to the
prices shown rather than starting at zero. Prices are never stored and
never exported.

The Watchlists view (`#watchlists`, `#watchlists/<list id>`) holds named lists
of companies, each company a name and an EODHD symbol. The lists are kept under
`wwws.watchlists.v1` as `{ version, last, lists: [ { id, name, items: [ { name,
symbol } ], updated } ] }`; `last` is the list open most recently. Until that
key exists on a device the page shows `STARTING_LISTS` from `index.html` (the
generic "My watchlist" and the custom lists from the owner's sample
screenshots), and the first change or opening writes them; from then on the
key holds whatever the reader keeps, and "Restore the starting lists" puts a
deleted starting list back in its place. The list tabs reuse the chapter tab
row. A company's name links to `#numbers/<SYMBOL>`, the Numbers page can add a
fetched company to a list, and a company whose numbers are kept carries a
"numbers kept" mark. The export file carries `watchlists` (the array above,
never numbers or the token); on import a list from the file replaces the one
here by `id` unless the one here was changed more recently, an identical list
is left alone, and lists absent from the file are left alone.

`tools/lib/pull.mjs` is the pull engine: `createContext`, `loadUniverse`,
`pull`, `writeScreens`, `recomputeRows`, `usage` (EODHD's user endpoint, for
the calls used today), `MARKETS` (the menu of markets, each a set of EODHD
lists with a US venue filter) and `loadSampleWatchlists` (reads
`STARTING_LISTS` out of `index.html`, so the lists have one copy). It pulls
every company's fundamentals for a set of exchanges (US filtered to NASDAQ
and NYSE, LSE, SHG, SHE, KO, KQ and XETRA by default) from EODHD on the
owner's machine, apart from the site, into `data/`: `symbols.json` (the
universe), `pulled.json` (the manifest), `raw/` (EODHD's replies, gzipped),
`companies/` (each company in the Numbers page's shape), `rows/` (the book's
ratios for the latest year), `screen/<VENUE>.json` (the rows per venue, for
screening in the browser) and `screen/<VENUE>.csv` (the same for a
spreadsheet). `tools/pull-fundamentals.mjs` is the command line over it,
with the token from `EODHD_TOKEN`; `tools/pull-app.mjs` is a local page on
127.0.0.1 over it (`npm run pull-app`): market and sample-watchlist
dropdowns, Start and Stop, progress, the calls spent and EODHD's own count,
the token kept in memory or in `data/eodhd-token.txt` when "remember" is
ticked. Neither puts the token in the repository or the site. A pull stops
on EODHD's 402 and resumes next run. The engine's company shape, next-report
rule and ratio formulas mirror `extractCompany`, `nextReport` and
`NUMBER_ROWS` in `index.html`: change them together. Nothing on the site reads
the pull yet; the plan is an R2 bucket the Worker serves from, gated with
Cloudflare Access because EODHD's personal plans forbid redistribution, then
the Numbers page reading it and a screen view.

The look is a financial newspaper: paper `#FFF1E5`, ink `#33302E`, claret
`#990F3D` for accents, teal `#0D7680` for links, Playfair Display for the
masthead and headlines, Newsreader for text, the system sans for controls. The
fonts are self-hosted under `public/assets/fonts/`; they never change, which is
what the immutable cache on `/assets/*` is for. Anything else moved under
`/assets/` needs a fingerprinted name. Keep `index.html` single-file.

Two rules keep the page still when switching views: `scrollbar-gutter: stable`
on `html`, so the centred column neither moves nor narrows when a scrollbar
appears, and at desktop widths the section dropdown's slot stays in the
controls row on Numbers and Watchlists (`visibility: hidden`, not `display:
none`) so the row has one height in every view. Do not remove either.

## Local development

```bash
npm install
npm run dev          # wrangler dev
```

## Verification - before every push to main

1. `npx wrangler deploy --dry-run`
2. Serve `public/`, render it with headless Chromium, and inspect the
   screenshots: styles applied, fonts loaded, layout intact. In the cloud
   container Chromium lives at `/opt/pw-browsers/chromium`.
3. For a change to the script, drive the page in a headless browser: open a
   chapter, type into both boxes, reload, export, clear storage, import, and
   check the text comes back. `playwright-core` with that Chromium does it.
   For the Companies view, answer `**/api/eodhd/fundamentals/**` from a fixture
   shaped like an EODHD reply and check the table's cells, and answer the
   `real-time`, `eod` and `intraday` paths from stand-ins shaped like EODHD's
   replies to check the price line and its chart.
4. For a change to `src/worker.js`, run the real Worker:
   `npx wrangler dev --var EODHD_BASE:http://127.0.0.1:<port>/api/` against a
   local mock of EODHD, and check the assets, the 404 page and every relay path.

Never leave pushed work unverified or half-finished. Work in small, complete
batches: implement, verify, commit, push.

## Git and release workflow

- Before committing: `git config user.name "Fid" && git config user.email "fid_kk@proton.me"`
- Develop on the working branch and push there first. Release verified work by
  fast-forwarding `main` onto it and pushing `main`.
- Every push to `main` is a release. Versions are an ascending `vMAJOR.MINOR`
  sequence starting at `v1.0`; every push bumps the minor regardless of size. A
  major bump is reserved for a ground-up overhaul.
- With every push to `main`, provide release-tag text in the reply, in exactly
  this shape. The owner creates the GitHub release manually - **never push tags**:

  ```
  Tag: v<next>  —  Title: <five to nine words, plain and evocative>
  Description: <one to three sentences of editorial prose describing what changed
  from the owner's point of view — outcomes, not implementation. No bullet lists,
  no jargon, no file names.>
  ```

- Append the release line to the ledger below as part of the same push.
- Commit messages: descriptive imperative first line (what the change does, not
  "update X"), then a short prose body; dash bullets are fine there. One commit
  per coherent piece of work; several may share a push, but each push gets
  exactly one version entry.
- Never include model names, AI attribution trailers, session links, or other
  tooling identifiers in commit messages, titles, or code.

## Prompt archive

`prompt text/` holds the records for the version currently in service -
nothing else. Shipping version N replaces the folder's contents wholesale, in
the same push that releases the version: remove the previous version's
folder(s) and add `prompt text/N/` containing `input.txt` (the prompt, byte for
byte), `output.txt` (the reply that shipped it, byte for byte), `ai model.txt`
(three lines: Anthropic / Claude / Fable 5 Max unless the owner directs
otherwise) and every input image and file the owner provided, each under its
own name. The files are owner-supplied records: never edit, reformat, trim or
regenerate them.

The version number N is the count of prompts that have shipped, one more than
the folder in service. It is not the release tag: a push that ships no new
prompt leaves the archive as it is.

## The page itself

Content, design, and behaviour are as supplied by the owner. Do not tidy markup,
rename classes, rewrite copy, or modernise CSS unless asked - changes to the
design are their own release, requested deliberately.

## Release ledger

| Version | Title | Description |
| --- | --- | --- |
| v1.0 | The chapter list goes up, plain and unstyled | The site now exists and lists all fifty-seven chapters of Warren Buffett and the Interpretation of Financial Statements, grouped the way the book groups them: the opening chapters, then the income statement, the balance sheet, the cash flow statement and valuation. It is deliberately bare for now, a plain list with no styling, so the words are up first and the look can follow. |
| v1.1 | Every chapter gets a page to write in | Each chapter of the book now opens on its own page with a summary box and a notes box beneath it, and what you type is kept in your browser as you go. Export saves everything you have written to a file, and Import brings it back, so you can pick up where you left off on another day or another device. |
| v1.2 | Salmon paper, serif headlines and chapter tabs | The companion now reads like a financial newspaper: salmon paper, dark ink, a serif masthead and headlines, with your writing in clean white boxes. A section dropdown narrows the book to one part and a row of numbered tabs picks the chapter within it, a dot marking every chapter you have written on, while the contents page keeps the whole table of chapters in two newspaper columns. |
| v1.3 | Every chapter now says what kind it is | Each chapter page opens with a chapter type, set with one click: Overview for a chapter that introduces a run of chapters, Metric for one that explains a single line item or ratio, or Background for the ones that are there for context only, such as the introduction. The choice saves with your notes, travels in exports and shows as a small tag beside the chapter in the contents. |
| v1.4 | The book's numbers, fetched for any company | A Numbers tab now sits beside Chapters: give it a ticker and your own EODHD key and it lays out the company's full yearly history of the figures the book walks through, statement by statement with the chapter beside each line and the book's rule of thumb under each ratio, from gross margin to the years of earnings it would take to clear the long-term debt. Companies you fetch are kept on your device, the table downloads as a spreadsheet, and the key never leaves your browser. The line above the masthead is gone. |
| v1.5 | The page holds still between views | Switching between Chapters and Numbers no longer nudges the page: the column keeps its width and position whether or not a scrollbar is showing, and the row of controls keeps one height in both views, so the masthead, the buttons and the text below stay exactly where they were. |
| v1.6 | The book's rules of thumb now read in claret | Under each ratio in the Numbers table, the book's rule of thumb now sits in the same claret as the negative figures, so the book's voice stands apart from the data at a glance. |
| v1.7 | Pinned headings, open quarters, latest year first | The Numbers table now runs newest first, the latest year at the left, and sits in its own frame: the year headings stay pinned as you scroll down, the line names as you scroll across, and the scrollbars are always drawn. Click any year heading and its quarters unfold beside it, newest first, with the ratios that need a full year's earnings built on the trailing four quarters, and a "to date" column carries the quarters reported since the last year end. |
| v1.8 | Watchlists, with the sample lists already filled in | A Watchlists tab now sits beside Chapters and Numbers, holding named lists of companies: one generic list and the thirteen custom lists from the screenshots, Chips and RAM through to Quantum and Lithography, each company under its EODHD ticker. A company's name opens its numbers, a fetched company can be added to a list from the Numbers page, and lists can be made, renamed, added to, trimmed and deleted, with the starting lists one click from being restored. Lists stay on the device and travel in the export file. |
| v1.9 | EODHD's refusals now say what is actually wrong | When EODHD turns a fetch down, the Numbers page now tells you which of three things happened: the token is not recognised, today's calls are used up, or the plan does not cover fundamentals for that ticker, in which case it says the token itself is fine and which plans do. Before, a plan without fundamentals was reported as a rejected token. |
| v1.10 | One long table, the sideways bar always in view | The Numbers table no longer scrolls inside a box of its own: it runs the full length of the page, with the year headings staying at the top of the window as you scroll down and the line names at the left as you scroll across. The sideways scrollbar now sits at the foot of the window for as long as the table is in view, so the earlier years are always one drag away. |
| v1.11 | Whole exchanges pulled from EODHD, off the site | A new tool pulls every company's fundamentals for the United States, London, Shanghai and Shenzhen from EODHD on your own machine, apart from the site, keeping each reply, each company in the shape the Numbers page uses, and a row of the book's ratios per company for screening. It stops when the day's calls run out and carries on next time. The site itself is unchanged; the parts that will read the pull come next. |
| v1.12 | Korea and Germany join the exchanges pulled | The puller now takes the Korea Stock Exchange, KOSDAQ and Germany's Xetra alongside the United States, London, Shanghai and Shenzhen, around seventeen thousand companies in all, still within two days of the daily allowance. |
| v1.13 | The next report date, and a graph for every line | A company's page now says when its next report is due, before or after the market and with the analysts' estimate, right under its name. Every line of the Numbers table has a small graph button that opens a popup chart of that line, as a line or bars, by year or by quarter, over any range or the last 5 or 10 years, with an optional trend line or mean band and the figures beneath it: mean, median, standard deviation, variance, how steady the trend is, growth, and how often and how far the line fell. |
| v1.14 | A page on your own machine to pull markets and watchlists | A local page now does the pulling: choose a market from a dropdown, or one of the sample watchlists from another, paste your EODHD token once, press Start, and watch the companies come in with the calls spent this run and EODHD's own count of calls used today. Stop ends a run cleanly and the next Start carries on. Everything lands in the data folder as before, with a spreadsheet file for each market alongside the site's own. |
| v1.15 | Companies first, with eighty of them already on file | The site now opens on the company page, renamed Companies, with Chapters moved to its own tab. Eighty companies from the owner's own pull come with the site as sample data, from Apple to Zscaler and the London, Paris and Xetra names in the watchlists, so they open at once without spending a call, and a live copy is one click away. The company page lost its "also kept" line and the paragraph about units and quarters. |
| v1.16 | The share price, and its chart, above the table | Each company's page now shows its current share price above the table, with the day's change and the time of the quote, once your EODHD token is in the box. A Graph link beside it draws the price the way a broker's app does, with a row of spans to pick from: the last day in five-minute steps, a week, a month, six months, a year, five years, ten years or all time, with the start, end, change, high and low for the span underneath. |
