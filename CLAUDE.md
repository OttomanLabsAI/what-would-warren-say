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
  index.html       all five views (companies, screen, watchlists, contents, dropdown, chapter tabs, chapter pages, account): one file
  data/            sample data: index.json + companies/<SYMBOL>.json, from tools/bundle-samples.mjs (git-tracked, EODHD-derived)
  data/screen/     the pull's screen rows: <VENUE>.json + index.json (venues, symbol -> venue) + names.json (every company's symbol, name and venue, for the search), from tools/bundle-screen.mjs
  404.html         same masthead and palette as index.html
  favicon.svg
  _headers         security + caching headers
  robots.txt
  assets/fonts/    Playfair Display + Newsreader + EB Garamond woff2 (OFL), the only assets
src/worker.js      /api/eodhd/{fundamentals,real-time,eod,intraday,splits}/<symbol> -> eodhd.com; /api/data/<key> -> the R2 bucket (binding DATA); everything else -> env.ASSETS
wrangler.jsonc     main + assets (binding ASSETS, 404-page) + EODHD_BASE var; r2_buckets DATA -> wwws-data commented out until the bucket exists
package.json       wrangler devDependency + dev/deploy/check/pull/pull-app/bundle-samples/upload-store scripts
tools/lib/pull.mjs  the pull engine: lists, fetches, extracts, screens; mirrors the page's extraction
tools/lib/store.mjs  the store uploader: SigV4 over R2's S3 API, the upload plan, index.json, uploaded.json
tools/pull-fundamentals.mjs  the command line over the engine: whole exchanges into data/, apart from the site
tools/pull-app.mjs  a local page over the engine: market or sample-watchlist dropdowns, Start, Stop, calls spent, Send to the site
tools/upload-store.mjs  the command line over the uploader: a pull into the bucket
tools/bundle-samples.mjs  copies a pull's companies into public/data/ as the site's sample data
tools/bundle-screen.mjs  copies a pull's screen rows into public/data/screen/ with an index, so companies open from their rows
data/              the pull's output: git-ignored, EODHD-licensed, never committed
notes/             the owner's exported notes, byte for byte: the source of BREAKDOWNS in index.html
firebase/          the account store: firestore.rules, firebase.json (rules path, emulator ports), firestore.indexes.json, .firebaserc
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

Chapters the owner has finished are written up in `BREAKDOWNS` (keyed by
chapter id): `type` (the owner's chapter type), `tldr` (the plainest
instruction for the reader, one sentence, drawn as a boxed "TL;DR" line
under the type line and above the thesis; every chapter written up carries
one, in the owner's words where they gave them, as for chapters 15, 16, 18
and 20, and a chapter written up later gets one too, at the owner's
standing request), `thesis`, `diagrams` (each
`{ kind, title, … }` drawn by `diagramHtml`: `flow` boxes and arrows, with
`numbered: true` a "Step 1, Step 2" label in each box so it reads as
instructions (chapter 8), `equation` `terms` joined by `ops` (a claret −, ÷
or =, the last term the bold result) with an optional `example` row of
figures and a `note`, which is how the owner wants "revenue less expenses"
shown (chapters 7, 9 and 10), `tree`
a root with branches and chips, `cols` columns, `charts` a row of small
line charts (`{ title, sub, years, values }` each, `unit` as in
`NUMBER_ROWS`, a `note`; the html carries a slot per chart and the series
go into `chapterCharts`, and `drawChapterCharts`, called by `renderChapter`
once the chapter is on the page and again on resize, draws each with
`chartSvg` at its slot's width and wires the hover readout), `checks` a tick list with a
note, `sum` lines adding to a total, `compare` labelled rows, `sheet` the
book's balance sheet as two sides (`sides`, each `{ title, rows, rules,
arrows }` drawn by `statementRows`, the rows as a `statement`'s, in one
white box under the sheet's title and unit; `SHEET_21` holds the one from
the owner's photographs of chapter 21, the two totals agreeing at
$43,059), `statement` the
book's income-statement box with `rows` (a row of `null` is a gap, a value
of `null` a heading), `rules` under rows and `arrows` on the chapter's
lines (the older `rule` and `arrow` still read), as in the owner's
photographs: `STATEMENT_BOX` for chapters 8 and 9, reused with the arrow
on Gross Profit for chapter 10, and `opexBox` over `OPEX_ROWS` for
chapters 11 to 15 (chapter 12's third operating line reads "Interest" in
the book and is kept so; chapter 15 adds the Interest Expense line) with
`OTHER_ROWS_16` for chapter 16 and, carried on below operating profit from
the owner's photographs of chapters 17 to 19, `PRETAX_ROWS` (Income Before
Tax, the arrow on it), `TAX_ROWS_18` (Income Taxes Paid) and `NET_ROWS_19`
(Net Earnings, a rule under the taxes paid)), `points`, and `raw` (the owner's summary from the export, byte for
byte, shown closed under "Your notes, as written"). A chapter whose notes
give examples has a `body` instead of `diagrams` and `points`: the parts in
the order of the notes, each a diagram, `{ points: [...] }` or `{ examples:
[...] }`, the examples `{ title, sub, items, inline }` groups drawn by
`examplesHtml` as a section of their own wherever the notes have them,
headed "Examples from your notes" and, on a chapter's first such section
only, dated with `EXAMPLES_NOTE` (the book's first edition of 2008 and the
2011 second edition the owner reads; the figures of that time), `inline`
running plain names in one line. Chapter 3 has the tree, the examples,
then the points; chapter 10 the box, the two equations, points, the
examples, a point, the margin table, points; chapter 12 points, the SG&A
equation, examples, the share table, a point, examples; chapter 13 the
table of how a research-built advantage dies, an example, a point,
examples, points; chapter 14 points, the depreciation equation with the
book's press as its example, the press as a worked example, the three
statements it shows up on, points, the share-of-gross-profit equation,
examples, a point; chapter 15 the table of why interest runs high, a
point, examples, the share-of-operating-income equation with the 15% rule
as its note, a point; chapter 16 a point, the gain-or-loss equation, the
book's property as a worked example, points; chapter 17 the box, a point,
the pre-tax equation with the box's figures (the book takes every line
below operating profit off it), points; chapter 18 the box, points, the
tax check as an equation (income before tax times the rate, 35% in the
book's day, against the taxes paid), points; chapter 19 the box, the
net-earnings equation, points, the buyback trick as two columns of made-up
figures (the owner asked for a worked example; the title says the figures
are made up), points, the share-of-revenue equation, the book's two
companies as a compare, points, examples, the tiers as a compare, a point;
chapter 20 the earnings-per-share equation, points, the book's two
ten-year columns of earnings per share from the owner's photographs
(2008 down to 1998, the consistent run and the erratic one) as `cols`, the
same two runs as line charts underneath (`charts`, 1998 at the left, the
losses in claret under the zero line), and
the book's readings of them as examples; chapter 21 points, the two parts
of a balance sheet as `cols` (the kinds of asset and liability the book
lists on its pages 69 and 70), the book's balance sheet as a `sheet`, the
net-worth equation with the book's $100K and $25K, the three-way compare
(the book's two businesses and the sheet's own totals), a point; chapter
22 the book's box of the assets (the sheet's assets side, from the owner's
photograph of page 72), points, the two kinds of asset as a `tree` (the root
Total assets, a branch each for the current assets and all the other assets,
the lines of each as chips), points; chapter 23 the book's box of the
current assets (`CURRENT_BOX`: the sheet's first six lines, the total with
its dollar sign, the arrows on cash, inventory and receivables, as the
owner's photographs of chapters 23 and 24 print it), points, the cycle as a
`flow` (Cash, Inventory, Accounts receivable, Cash), a point; the owner's
"DSA" in chapter 23's notes is read as DCA. Chapters 11 to 19, 22 and 23
open with the book's box. `partHtml` draws a part; a chapter without a body
draws its diagrams, then its points. `renderChapter` draws a
breakdown instead of the boxes for those chapters, `entryFor` and
`isWritten` make them count as written with their type in the contents, the
marks and the tab dots, and local entries for them are left alone. The
source is the owner's export under `notes/` (the latest export replaces
the file of the same name; chapters 1 to 23 so far, the whole income
statement and the first three of the balance sheet); a new export with more finished chapters means writing them up
here and keeping the file. Anything in square brackets in the owner's
notes is an instruction to the write-up, not a note: "[make an example
calculation]", "[show an example calculation]", "[add examples from the
photos]" and whatever comes later. Every one is carried out in the chapter's
write-up, with the book's figures where the book gives them and with
figures marked as made up where it does not, and the notes as written keep
the brackets. A write-up with a bracket left unanswered is unfinished. DCA in
the owner's notes is the book's Durable Competitive Advantage: a write-up
says it in full, as `TERM`, wherever it is mentioned (never the short form,
never "durable advantage"), and `wr` (escape, then the term in `<strong
class="term">`) renders every thesis, diagram text and point so it reads in
bold: 600 in Newsreader and the sans, 900 in the Playfair thesis, inherited
where the line is already bold. The notes as written are never marked up.

The Companies view (the tab is labelled Companies; the code still calls it
numbers: `renderNumbers`, `view-numbers`, `wwws.numbers.v1`) fetches EODHD
fundamentals through the relay with the reader's own token in an `X-Api-Token` header,
keeps the extracted company under `wwws.numbers.v1` (eight most recent; yearly
statements plus the last `MAX_QUARTERS` = 40 quarters as `incomeQ`, `balanceQ`,
`cashflowQ`, `sharesQ`, `epsQ`, `reports`, EODHD's report history from
`Earnings.History` as `{ date, quarter, when, eps, estimate }` oldest first
(the report date, the day of the earnings call; the quarter it was for;
`BeforeMarket` or `AfterMarket`; the figure and the estimate; the reports
still to come included; `readReports`, absent on a copy kept before it
existed), and `splits`, EODHD's split history as
`{ date, split, ratio }` oldest first, `[]` when there is none, absent on a
copy kept before it existed) and the token under `wwws.eodhd.token` only
when "remember" is ticked. A fetch asks `fundamentals/<symbol>` (ten calls)
and then `splits/<symbol>` (one), and keeps the company without the list if
that second call fails. The table runs the full length of the page inside
a `.table-frame`: the `.table-wrap` scrolls sideways with its own scrollbar
hidden, the `.table-bar` under it mirrors that scroll and sticks to the foot
of the window while the table is in view (`bindFrames` wires the two and
sizes the bar), the `.item` cells are sticky to the left, and the heading
cells are shifted down with a transform as the page scrolls so they stay at
the top of the window, which sticky positioning cannot do from inside a
sideways scroller (`border-collapse: separate` so the sticky borders hold).
Do not put the table back in a box that scrolls on its own. A statement
heading row is a sticky `th.item` plus one empty `td` spanning the value
columns that carries the rule across, so the heading stays in view while the
table scrolls sideways (a cell spanning the whole row cannot stick). Under
40rem the `.item` column is fixed at 8rem and the "to date" heading wraps,
so two years of figures sit beside the line names on a phone; that media
block is the last thing in the stylesheet so nothing above it outranks it. Columns run
newest first: the "to
date" column, then each year with its quarters, newest first, to its right. A
year heading with quarters is a `button.yr`; `columnsFor` builds the columns,
`quarterData` the quarter values, and rows flagged `annual: true` use
`trailingFour` sums in quarter columns. A "to date" column (`date: 'todate'`)
carries quarters after the last year end. A company also keeps `next`, the
earliest report still to come from EODHD's `Earnings.History` (`date`,
`quarter`, `when`, `estimate`, or `null`; `nextReport` finds it), shown under
the headline by `nextReportHtml`; a company kept before `next` existed shows
a "fetch again" line. Under the price block, above the next-report
line, `aboutHtml` shows what the company does: `meta.description` (EODHD's
`General.Description`), clamped to three lines with a More button past
`ABOUT_CLAMP` characters, and a facts line from `meta.web`, `meta.employees`,
`meta.ipo` and `meta.country` (`General.WebURL`, `FullTimeEmployees`,
`IPODate`, `CountryName`; `meta.address` is kept but not shown). A company
without the fields, kept or pulled before they existed, says "Not on file"
in the same place; a row company shows the row's `about`, a short form of
the description, with its `web`, `employees`, `ipo` and `country`. Every line of the table carries a `button.graph`
(`data-row` is its index in `NUMBER_ROWS`) that opens one `<dialog
class="graph-dialog">`, built once by `ensureGraphDialog`: `graphPeriods` and
`graphValues` give the series (yearly, or quarterly through `quarterData` so
`annual: true` rows use the trailing four quarters), `graphStats` the
figures (mean, median, sample variance and deviation, coefficient of
variation, low, high, least-squares slope and R² on the period index,
change, compound growth a year, falls and the largest fall), `chartSvg` draws
the inline SVG (grid, axis, line or bar marks, the optional trend line or
mean band, the last value labelled, hit bands for the hover readout) and
`figuresHtml` the list under it. The range is a slider under the chart
(`#graph-range`: two native range inputs, `#graph-from` and `#graph-to`,
stacked on one track so each thumb can be grabbed, the claret stretch
`#graph-sel` between them in the track's own terms, the first and last
periods on offer at the ends and the range itself between them,
`#graph-span`; hidden with fewer than two periods) over every period kept
on the graph, years or quarters (`graph.periods`, filled by
`fillGraphRange`, the dates still kept as `graph.from` and `graph.to`;
`syncGraphRange` puts the thumbs on them, `slide` reads a moved thumb and
takes the other along when pushed past it). The Window group is one box,
"Last 10 years" (`#graph-ten`, `graph.window` `'10'` or `'shown'`): ticked,
`applyGraphWindow` moves the slider to the last ten years (forty quarters);
unticked, to the whole run; a hand-moved thumb unticks it. A graph opens
with the box ticked, at the owner's request; the dropdowns and the other
presets went in v1.39. The last value's label (`text.end`) sits centred
over its own mark, kept inside the right edge, lifted (dropped, under a
negative) clear of any neighbouring mark it would cover, with a paper halo.
Above the table, between the Add to line and the table, a company with
years on file (not a row-only one) carries the button "Warren Buffett's
Analytics" (`#analytics-open`), which opens one `<dialog
class="graph-dialog analytics-dialog">` built once by
`ensureAnalyticsDialog`: `openAnalytics` lays out one full-width section
(`.tile`) a line for `ANALYTICS` (the `rowKey` of a `NUMBER_ROWS` line, the
section's `name`, its judge, in chapter order: gross margin, SG&A, R&D and
depreciation as shares of gross profit, interest as a share of operating
income, the effective tax rate, net earnings, net margin, earnings per
share), each, at the owner's request, as the table's lines read: the
heading and its chapter link, what Warren looks for in claret (the line's
`rule`, in the table's `.rule` style), the chapter's `tldr` on one line,
then the interactive graph and the verdict. The graph works like the
popup's: a Chart segment (Line, Bar), a Trend segment (None, Straight
line, Mean band), a "Last 10 years" switch (`.ten`) and the two-thumb
slider (`.tile-range`, `syncTileRange`) over every year on file
(`graphPeriods`, `graphValues`, `graphStats`), each section with its own
state (`kind`, `trend`, `window`, `i0`, `i1`, defaults line, the trend,
the last ten years; a moved thumb unticks the switch), the dialog's one
set of click, change and input listeners finding the section through
`tileOf`, and `drawTile` drawing the years between the thumbs with a 240px
`chartSvg` (`chartSvg` takes the height as its ninth argument), wiring the
hover readout, pressing the controls and writing the verdict over the
years shown (`drawAnalyticsCharts` redraws every section on resize); the
verdicts: `judgeGrossMargin` (40% or more every year passes, below 20% or
mostly fails), `judgeSga` (steady, within 10 points, passes, and 30% or
less every year is "low and steady"; a swing over 25 points fails),
`judgeRd` and `judgeTax` (a note with the figures and the book's caution,
no pass or fail), `judgeDepreciation` (10% or less this year and on
average), `judgeInterest` (none is best, under 15% every year passes; a
year with no operating income is left blank), `judgeNetEarnings` and
`judgeEps` (rising, the trend up and the last above the first, steadily,
R² of .6 or more and at most two down years, with no loss, passes; not
rising fails; the rest mixed) and `judgeNetMargin` (20% or more this year
and in most years passes, under 10% fails, between is the grey area). The
verdict carries a mark (`VERDICT_MARKS`: a tick on green for pass, a
cross on claret for fail, a tilde for mixed, an i for a note) and says the
term in full through `wr`. Revenue, the costs and the other lines Warren
does not judge on their own have no tile, at the owner's request, and
only chapters written up count: a chapter written up later that gives a
line a rule adds a tile to `ANALYTICS` with its own judge, in chapter
order, as part of writing the chapter up. A chapter link in a tile closes
the dialog and opens the chapter.
No chart library: the page still loads nothing
from elsewhere. The export
file never carries numbers or the token. `NUMBER_ROWS` in `index.html` maps
the book's lines to EODHD field names, several candidates per line, with the
chapter and, on the lines where the book gives a basic instruction, a
`rule`: one short sentence in claret under the line and over the line's
graph, the book's rule of thumb with the threshold as the owner's notes
have it ("40% and up is good; below 20% is not good."). The plain lines,
revenue, the costs, the profits, carry none: the owner wants the table kept
this short and the chapter page to hold the detail, and had the long rules
of v1.37 (examples, consistency tests, several sentences a line) cut back
in v1.43. A chapter written up later adds a rule only where its notes give
a new threshold or a basic instruction for a line that had none, in one
short sentence. The rules are plain text (`esc`, not `wr`) and say durable
competitive advantage in full, never the short form; "Every field EODHD
reports" shows the raw statements. Sample data: `public/data/index.json` lists companies the
owner pulled and `public/data/companies/<SYMBOL>.json` holds each in the
page's shape (`tools/bundle-samples.mjs` writes both from `data/`); the page
loads the index at boot (`loadSamples`), opens a company's file on first view
(`loadSample`, kept for the session with `sample: true`), and a kept copy
takes precedence over the sample. A sample company's page says "Sample data
pulled", offers "Fetch a live copy" and has no Forget. The company page
carries no "also kept" line and no units paragraph: the owner had them
removed.

The bundled screen rows (`public/data/screen/<VENUE>.json` plus `index.json`
with `venues: { <VENUE>: { file, companies, withStatements, pulledUpTo } }`
and `symbols: { <SYMBOL>: <VENUE> }`, written by `tools/bundle-screen.mjs`
from `data/screen/`) let any company of the pulled venues open without a
key. The page loads the index at boot (`loadBundleIndex`); a company that is
neither kept, in the store nor a bundled sample is built from its row
(`rowCompany`: `rowOnly: true`, `row`, one empty year in each statement so
the table has a column, `next` from the row's report fields, `fetchedAt`
from `pulledAt`), the venue's rows fetched once (`loadBundleRows`, shared
shape with the Screen's `prepareScreenRows`, whose `all` maps symbol to
row). `NUMBER_ROWS` entries carry `rowKey`, the screen-row field that holds
the line, and `cellValue` returns that field for a row-only company and
blank for every other line; the page says "Latest year only, from the
screen rows pulled", shows a note above the table, no graph buttons, no
quarters, no raw fields and no Forget, and "EODHD had no statements" for a
row without a year. The home page counts the companies on file by venue
(`bundleHtml`, shown when there is no store). The order a company is shown
from is: the kept copy, the store, a bundled sample, its row, the fetch form.
Without a key the price line reads "Not available without an EODHD key."
with no button; a key typed into the token box fetches it (`wirePrice`
listens to the box's change event).

The company search. The box on the Companies view (labelled "Company or
ticker", a combobox with the listbox `#suggest` under it) suggests
companies as the reader types: `suggestionsFor` ranks the pool from
`searchPool` (the kept copies, then the samples, then every name on file
from `screen/names.json`, `[symbol, name, venue]` a company, written by
`writeScreens`, copied by `bundle-screen.mjs`, sent to the store by the
uploader, and fetched by `loadNames` on the first keystroke from the
store when it has an index, else the bundle) by an exact ticker or code,
then a ticker prefix, a name prefix, a word prefix, then anything
containing the text, accents and punctuation ignored (`fold`), a kept
copy before a sample before the rest, and a code of letters before one
that starts with a digit (London's international book lists Apple as
0R2V), eight at most, each with its name, ticker, venue and where it is
from. The arrows move the highlight, Enter opens the highlighted
company, Escape and leaving the box close the list, a click or tap opens
one; opening goes to `#companies/<SYMBOL>`, from file, with no call. On
submit a ticker (`tickerShaped`: no spaces and a dot) or a bare code that
is a company on file fetches as before (`go`); a name opens its best
match; a word with no match that could be a code fetches it; anything
else says it is not on file. Without the names file the kept copies and
the samples still suggest. The Screen's own find box already matches
names and tickers.

The store is the owner's pull of whole exchanges in the R2 bucket `wwws-data`
(binding `DATA`), served by the Worker at `/api/data/<key>` with no key and
no gate (`store()` in `src/worker.js`: GET and HEAD, keys checked against
`STORE_KEY`, the object's ETag so a browser gets 304, `cache-control:
public, max-age=300`; without a bucket bound every key is 404, which is how
local development runs). The keys are `index.json` (`{ builtAt, pulledUpTo,
venues: { <VENUE>: { companies, pulledUpTo } }, companies: { <SYMBOL>:
<date pulled> } }`), `companies/<SYMBOL>.json` (the page's company shape,
with `fetchedAt`) and `screen/<VENUE>.json` plus `screen/index.json` (as the
puller writes them). The page loads `index.json` at boot (`loadStoreIndex`,
re-routing when it arrives), opens a company's file on first view
(`loadStored`, kept for the session with `store: true`), and shows a company
from the first of: the kept copy, the store, a bundled sample, the fetch
form. A stored company's page says "In the store, pulled", offers "Fetch a
live copy" and has no Forget; the home page says what the store holds by
venue (`storeHtml`) and points at the Screen; watchlists mark "in the store"
after "numbers kept" and before "sample data". The store is open because the
owner chose so while the site has no readers but them, knowing EODHD's
personal plans forbid redistribution; Cloudflare Access on a custom domain is
the step up if that changes. The bucket must exist in the account before a
deploy that carries the binding, or the deploy fails: the `r2_buckets` line
in `wrangler.jsonc` stays commented out until the owner has made the bucket,
and until then every store path answers 404 and the page falls back to the
bundled rows.

The Screen view (`#screen`, `#screen/<VENUE>`, `renderScreen`) lists every
company of a venue from `screen/<VENUE>.json`, read from the store when it
has an index and otherwise from the bundled rows (`screen.source` is the
base path chosen by `loadScreenIndex`): `SCREEN_COLUMNS` (the row's
figures and ratios, with their units), `SCREEN_RULES` (the book's rules of
thumb as predicates on a row, each with its chapter; keep them in step with
the `rule` texts in `NUMBER_ROWS`), `VENUE_ORDER` (the tab order; the first
venue present opens by default), `SCREEN_PAGE` = 200 rows at a time with
"Show more". `screenState` keeps the venue, sort column and direction, the
search text, the ticked rules and the rows shown for the session. Rows with
no `year` (no statements at EODHD) are counted in the heading and left out.
The venue tabs reuse the tab row, the table is a `.table-frame` like the
company table (pinned headings, sticky company column, the bar at the foot),
blanks sort last, and `drawScreenTable` redraws only the table and the count
line, keeping the sideways scroll.

The relay forwards only `fundamentals/<symbol>`, `real-time/<symbol>`,
`eod/<symbol>`, `intraday/<symbol>` and `splits/<symbol>` on GET (`ALLOWED`), passes on only the
query parameters in `PASS` (`from`, `to`, `period`, `interval`, `order`) when
they match their shapes, holds no secret, caches nothing, and passes EODHD's
status and body straight back.

Under the headline, above the About block, the company page carries the
price block (`priceHtml`, `wirePrice`, `#price`): once a token is in the
box it fetches `real-time/<symbol>` (one call), shows the price big, the
day's change and the quote time, keeps the quote in memory for
`QUOTE_LIFE` (fifteen minutes), and draws the price chart under the line
at once, at the owner's request; without a token it says so, with no
chart. A "Hide graph" link on the price line collapses the chart and
turns into "Show graph", the price staying on show; the choice is kept
under `wwws.priceGraph.v1` (`open` or `closed`, `priceGraphOpen`), and a
hidden chart fetches nothing until shown. The chart (`drawPrice`, into
`#price-graph`: the spans row `#price-spans`, the caption `#price-sub`,
`#price-body`, `#price-figures`, `#price-units`) opens on the 5Y span and
keeps the span last chosen for the session, with the spans in `SPANS`: 1D
is `intraday/<symbol>` at five-minute bars over the last five
days, reduced to the last trading day (five calls); 1W, 1M, 6M and 1Y are
`eod/<symbol>` by day, 5Y and 10Y by week, All time by month from 1900 (one
call each). `spanRequest` builds the request, `pricePoints` the points, and
each span is cached in `priceSeries` for the session. The chart is
`chartSvg` with unit `price`: a line, no dots, no end label, and the axis
fitted to the prices shown rather than starting at zero; it redraws on
resize. The spans row ends in an "Earnings calls" box (`#price-reports`),
off until ticked and kept for the session in `priceReportsOn`, never
stored: ticked, `reportMarks` finds the bar whose period holds each report
date in the span (its own day, its week or its month, by `barCloseDate`;
on a daily chart the line sits at the edge of the day's band the report
fell on, before the open or after the close, and on the day of five-minute
bars at the start or the end of the day), `chartSvg` draws them from its
eighth argument as dashed claret `line.mark`s, the hover readout adds the
bar's `note` (`reportNote`: "Earnings call after the close, quarter to 30
Sep 2026", read by `wireGraphHover` on any chart) and the units line says
how many fall in the span, that none does, or that the copy has no report
dates on file (`reportsText`; a sample or store copy pulled before the
history existed, or a kept copy fetched before it, until a fresh fetch). Under the chart, above the figures, the same two-thumb slider as
the graph dialog's (`#price-range`: `#price-from`, `#price-to`, the stretch
`#price-sel`, the ends `#price-first` and `#price-last` with the range
`#price-span` between) runs over every bar of the span loaded
(`priceGraph.all`; `priceGraph.range` is `{ symbol, span, n, i0, i1 }`):
`syncPriceRange` puts the thumbs on it, `slidePrice` reads a moved thumb and
takes the other along when pushed past it, and `renderPriceSlice` draws the
bars between them with their figures, the earnings-call marks found on the
whole span and kept where they fall inside, and the units line; a new span
or another company opens whole, a resize or a hide and show keeps the
range, and nothing of it is stored.
There is no price dialog any more. Prices are never stored and
never exported.

Stock splits. EODHD restates its per-share figures for later splits
already: `outstandingShares`, `Earnings.History` and the balance sheet's
`commonStockSharesOutstanding` alike, checked on the owner's own pull of
Apple, Nvidia, Tesla, Amazon, Alphabet and Broadcom, so the table's
per-share lines need no adjustment and get none. The daily closes are as
traded, so the price chart divides every bar struck before a split by the
splits since (`splitFactor`, applied in `pricePoints`, which takes the
rows kept in `priceSeries` and the company's splits at draw time), and its
units line says which splits it is restated for (`restatedText`). A bar is
judged by the day its close was struck, not its label (`barCloseDate`):
EODHD dates a weekly bar by its Monday and a monthly bar by the first of
the month, so the bar is placed at the end of that week (a bar dated
Friday or later is its own end) or the last day of that month; judged by
the label, the month of Nvidia's ten-for-one read as a crash to a tenth,
its close struck after the split but its date before it. The list
is EODHD's `splits/<symbol>` reply, kept by `readSplits` as it came,
`{ date, split, ratio }` with the ratio new shares over old, oldest first,
mirrored in `tools/lib/pull.mjs`. A company with none on file asks for it
once a session when its chart is drawn (`ensureSplits`; a failure is asked
again after `SPLITS_RETRY`, the chart drawn as traded with a note
meanwhile), and a kept copy saves it. The page carries no Splits line:
the owner had it removed in v1.36, and the only word of the splits is the
chart's units line, `splitText` reading the ratio as EODHD wrote it ("the
4 for 1 split of 31 August 2020").

The Watchlists view (`#watchlists`, `#watchlists/<list id>`) holds named lists
of companies, each company a name and an EODHD symbol. The lists are kept under
`wwws.watchlists.v1` as `{ version, last, lists: [ { id, name, items: [ { name,
symbol } ], updated } ] }`; `last` is the list open most recently. Until that
key exists on a device the page shows `STARTING_LISTS` from `index.html` (the
generic "My watchlist" and the custom lists from the owner's sample
screenshots), and the first change or opening writes them; from then on the
key holds whatever the reader keeps, and "Restore the starting lists" puts a
deleted starting list back in its place. The list tabs reuse the chapter tab
row. A company's name links to `#numbers/<SYMBOL>`, and a company whose
numbers are kept carries a "numbers kept" mark. Each list may carry a
`description` (voluntary, at most 280 characters, asked for by the New
list and Rename forms and shown in italics under the list's name) and the
list with id `my-watchlist` is the generic one (`GENERIC_LIST_ID`,
`generic: true` in `cleanLists`; `ensureGenericList` puts it back empty
when it is missing). Adding came back in v1.31 in a new form: the company
page carries an "Add to" line (`addToHtml`: a select of the lists, the
generic one first, a list that already holds the company disabled and
marked) and the list page an "Add a company by ticker" form with an
optional name (`addToList`, `knownName` finding the name among the kept
copies, the samples and the screen rows loaded). Rename, New list, Delete,
Remove and Restore stay; while signed in the generic list has no Delete. The export file carries `watchlists` (the array above,
with `description` and `generic`, never numbers or the token); on import a list from the file replaces the one
here by `id` unless the one here was changed more recently, an identical list
is left alone, and lists absent from the file are left alone.

The Account view (`#account`, `renderAccount`, the fifth tab) is the
reader's account at Firebase, spoken to over Firebase's REST APIs with no
SDK, so the page still loads no script from elsewhere: Identity Toolkit
for sign-up and sign-in (`authCall`), securetoken for refreshing the ID
token (`freshToken`), and the Firestore documents API with its typed
values (`storeCall`, `toFs`, `fromFs`, `getDoc`, `setDoc`, `deleteDoc`,
`listDocs`). `FIREBASE` holds the project's web API key and id, blank
until the owner sets them, with the three service bases; a test or a
local run puts its own hosts in `window.WWWS_FIREBASE` before the script
runs. Without a key the view says accounts are not switched on. A reader
signs up with a name, a surname, a username and a password (all required;
`USERNAME_RE`: 3 to 20 characters of letters, digits, dots, underscores
or hyphens, starting with a letter or digit; six characters of password);
at Firebase the username is the address `<username>@users.wwws.invalid`
(`usernameEmail`), never mailed. Sign-up (`signUp`) creates the auth
account, claims `usernames/<lowercase>` (create-only, `{ uid }`), writes
the profile `users/{uid}` (`name`, `surname`, `username`, `usernameLower`,
`createdAt`, `updatedAt`, `secretKey`, `secretKeyAt`) and syncs; if a
step fails the half-made auth account is deleted again. Sign-in
(`signIn`) reads the profile and syncs, and gives an account from before
the keys its key; `signOut` clears the session. The session is kept under
`wwws.account.v1` (`uid`, `refreshToken`, `name`, `surname`, `username`,
`syncedAt`, `createdAt`, `secretKey`, `secretKeyAt`); the ID token stays
in memory. The secret key (`makeSecretKey`: `wwws_` and 32 characters of
URL-safe base64 from 24 random bytes, `SECRET_KEY_RE`) says a request is
the reader's own, in an email for instance; the Account page shows it in
`#acct-key` with Copy and "Make a new key" (`rotateSecretKey` writes the
whole profile again, `profileDoc`, after a confirm; the old key is dead
at once), and the rules allow it only in that shape. It is never
exported. The data: `users/{uid}/
watchlists/{listId}` (`name`, `description`, `items`, `generic`,
`updated`) and `users/{uid}/data/entries` (`entries`, `updated`: the
chapter notes). Company numbers and the EODHD key never go up. Sync
(`syncAll` at sign-in and on Sync now; `queueSync` from `saveWatchlists`
and `saveEntries`, then `pushChanges` 600 ms later) follows the import
rules: the newer side wins per list and per chapter, lists only the
account has come down, a list only the device has goes up if it was ever
changed here (an untouched starting list stays on the device), and a list
this device had synced before but the account no longer has was deleted
elsewhere, so it goes; `pushed` remembers what the store holds so only
differences are written, deletions included. `firebase/firestore.rules`
keeps every reader to their own documents and checks the shapes (a claim
carries the claimant's uid and is never changed; a profile needs its
claim; a list needs a name, at most 280 characters of description, at
most 500 items, and the generic one cannot be deleted; only the `entries`
data document). The owner sets the project up once: a Firebase project
with Email/Password sign-in enabled and a Firestore database, the rules
deployed from `firebase/` (`npx firebase-tools deploy --only
firestore:rules --project <id> --config firebase/firebase.json`), and the
web API key and project id put in `FIREBASE`.

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
on EODHD's 402 and resumes next run. Each company costs `CALLS_PER_COMPANY`
= 11 calls: `CALLS_FUNDAMENTALS` = 10 for the fundamentals and
`CALLS_SPLITS` = 1 for `splits/<symbol>`, fetched right after and kept as
`raw/<SYMBOL>.splits.json.gz` and as the company's `splits`; the manifest
entry gets `splits: true`, or `splitsNote` with the reason when that call
failed, and `pullSplits` (`splitsDue` lists them; `--splits` on the command
line, the "Fetch splits" button on the pull page) fetches the list for
every company on disk without one, one call each, stopping on 402 like a
pull. `reextract` rebuilds every company's
file and row from the raw replies on disk with no calls, the saved split
list included, keeping each
company's `pulledAt` as its `fetchedAt`, so a field added to the extraction
reaches the whole pull without refetching: `--reextract` on the command
line, the "Rebuild from saved replies" button on the pull page. `shortAbout`
cuts the description to whole sentences of about 320 characters for the
screen row's `about`. The engine's company shape, next-report rule and ratio
formulas mirror `extractCompany`, `nextReport`, `readReports` and
`NUMBER_ROWS` in `index.html`: change them together.

`tools/lib/store.mjs` sends a pull to the store: `sign` (AWS Signature
Version 4 in its header form, region `auto`, service `s3`, checked against
AWS's published test vector), `objectPath` (each key segment encoded once),
`putObject` (one PUT with the payload hash, retried on a network error or a
5xx, stopped at once on a refusal with the reason), `planUpload` (every
company with statements from `pulled.json` and `rows/`, the screen files and
their index, and the `index.json` the page reads) and `uploadStore` (the
plan in parallel, `uploaded.json` so unchanged companies are skipped, the
index written last and only when nothing failed or stopped). The raw
replies, the rows folder and the CSVs never go up. `tools/upload-store.mjs`
is the command line over it (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `--bucket`, `--all`); the pull page's second form,
"Send to the site", does the same with the keys in memory or in
`data/r2.json` when remembered. Neither puts the keys in the repository or
the site.

The look has two schemes, chosen with the switch at the left of the dateline
(`.scheme`: two plain buttons, Newspaper and Original, the chosen one
`aria-pressed`; on a phone the dateline wraps, the switch on the first line
and the date on its own line at the right), kept under `wwws.scheme.v1`
(`original` or `newspaper`) and set as `data-scheme="original"` on `<html>`:
by the one-line script in the head before anything is parsed or painted, so
a reload shows no flash, and by `applyScheme` on a choice, which also moves
the pressed state and the meta theme-color. Newspaper, the default, is a
financial newspaper: paper `#FFF1E5`, ink `#33302E`, claret `#990F3D` for
accents, teal `#0D7680` for links, Playfair Display for the masthead and
headlines, Newsreader for text, the system sans for controls. Original is the
book's cover, at the owner's request: ivory paper `#F4EFE1`, black ink
`#1F1C17`, the masthead in the cover's own lettering, EB Garamond's
capitals at the regular weight, widely spaced, in the cover's dull gold
`#857A52` (v1.44 set it in Cinzel at 700; the owner found that heavier than
the cover and asked for slim, so no Cinzel file remains), EB Garamond for
the text (with lining figures) and the headlines (small caps), the claret
kept as the owner asked, the links in the gold's darker tone `#6B6239`.
Switching moves nothing on the page, at the owner's request: the title
sizes are the variables `--mast`, `--head` and `--h3` on `:root`, each
scheme's `.masthead h1`, `.headline` and `.graph-head h3` take their line
height from them (`calc(var(--mast) * 1.05)` and so on), and the Original
sets its capitals at a fixed share of the size (`.686` of `--mast` at .1em
spacing, `.905` of the headline sizes), measured so a title runs as wide in
either face and so breaks on the same word; EB Garamond's two faces carry
`size-adjust` (111% upright, 105% italic), measured so a line of text,
of the tagline or of a thesis is as wide as in Newsreader at the same
font-size, which is why the Original's body keeps the Newspaper's 1.125rem
and no `em`-based box changes. A new display size goes through a variable
the same way. It is the one
`:root[data-scheme="original"]` block, which overrides the variables and
those few rules; nothing else in the stylesheet knows the scheme, so a new
rule uses the variables. `404.html` carries the same variables, faces and
head script and follows the choice, with no switch. The choice is a device
setting like the price graph's: never exported, never synced. The controls
follow the owner's input-tools page in both schemes: square, a hairline or
ink border, small spaced capitals; a filled button turns outlined under the
pointer and an outlined one fills; a choice of several (the scheme switch,
the spans row's `.seg`, the `.types` of the chapter type and of the graph
dialog) is butted segments, the chosen one filled, the radio hidden; every
on/off box (`.opt`, `.remember`, `.rules`, the graph dialog's `.type.switch`)
is a switch, a square whose knob slides to the right when on, drawn on the
native checkbox so `checked` is still the state, its track green (`--on`)
when on and claret when off, at the owner's request, so the state reads at
a glance; text inputs and selects
have the hairline border and an ink border with an inset ring on focus; the
claret stays for the accents, not the controls. The fonts,
three families under the OFL, are self-hosted under `public/assets/fonts/`;
they never change, which is what the immutable cache on `/assets/*` is for.
Anything else moved under `/assets/` needs a fingerprinted name. Keep
`index.html` single-file.

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
   `real-time`, `eod`, `intraday` and `splits` paths from stand-ins shaped
   like EODHD's replies to check the price line, its chart and the splits. For the store and the
   Screen, answer `**/api/data/**` from the screen files of a real pull and
   from stand-in company files, and once with 404s for the no-store case.
4. For a change to `src/worker.js`, run the real Worker:
   `npx wrangler dev --var EODHD_BASE:http://127.0.0.1:<port>/api/` against a
   local mock of EODHD, and check the assets, the 404 page and every relay path.
   For the store, seed the local bucket first (`npx wrangler r2 object put
   wwws-data/<key> --file … --local --persist-to <dir>`) and start dev with
   the same `--persist-to`, then check `/api/data/…`: the index, a company,
   a screen file, a 304 on If-None-Match, 404s for what is not there.
5. For a change to `tools/lib/store.mjs`, drive the uploader against a mock of
   R2's S3 API that recomputes every signature, and `tools/pull-app.mjs` in a
   browser against that mock and a mock of EODHD.
6. For a change to the accounts or `firebase/firestore.rules`, drive the page
   against the Firebase emulators with the repository's rules
   (`npx firebase-tools emulators:exec --only auth,firestore --project
   demo-wwws --config firebase/firebase.json "node <the suite>"`, the page
   given the emulator hosts in `window.WWWS_FIREBASE`; the emulators need
   Java): sign up, sign in on a fresh device, every list and note change
   reaching the store, and another account's token refused by the rules.

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
| v1.17 | The numbers table readable on a phone | On a phone the names of the lines no longer take the whole width of the table: they sit in a narrow column, with two years of figures beside them and the rest a swipe away. The statement headings, Income statement, Balance sheet and Cash flow statement, now stay put as the table scrolls sideways, as the line names already did. |
| v1.18 | Adding to a watchlist set aside for now | The two ways of putting a company into a watchlist, the dropdown on a company's page and the form under each list, are gone for now and will come back later in another form. The lists themselves stay as they were: open, rename, remove a company, make and delete a list, and bring the starting lists back. |
| v1.19 | The masthead asks its question | The site's name now carries its question mark, on the masthead, in the browser tab and on the not-found page: What Would Warren Say? |
| v1.20 | Every company on NASDAQ, NYSE and London, no key needed | Every company you pulled now opens on the site without a key: eighty with their full history, the rest from the pull's screen rows with their latest year's figures, and whatever is not on file, the earlier years, the quarters and the share price, is left blank with a note saying so. A new Screen tab lists every company of an exchange by the book's ratios, sortable and searchable, with the book's rules of thumb as tick-box filters. The store that will hold the full pull is built and waits only for its bucket. |
| v1.21 | What each company does, under its name | A company's page now opens with what the company does: EODHD's description of the business, three lines at a time with More for the rest, and beside it the website, the head count, the year it listed and its country, all above the next report date and the price. Companies pulled before this carry the line once their files are rebuilt from the saved replies, which the pull page now does with one button and no calls. |
| v1.22 | Ten chapters written up, boxes become breakdowns | The chapters you have finished, the first nine and the eleventh, now read as written-up breakdowns instead of boxes to type in: a thesis, a diagram of how the chapter's ideas fit together, the points, and your notes as you wrote them, kept underneath. Chapters 8 and 9 carry the book's own income-statement box from your photographs, with the arrow on the line each chapter is about. Your export is kept in the repository as it came. |
| v1.23 | Five years by default, the advantage named in full | The share-price chart now opens on its five-year span, and the graph behind any line of the table opens on the last five years, with the other spans and windows one click away as before. The written-up chapters now say Durable Competitive Advantage in full and in bold wherever your notes say DCA, while the notes themselves stay as you wrote them. |
| v1.24 | The current price, big, above its chart | The share-price chart no longer prints the latest price beside the end of the line. The current price now sits as a big figure at the top right of the chart's window, with the day's change and the time of the quote beneath it, where the eye goes first. |
| v1.25 | Chapter 10 written up, the arithmetic as equations | Gross profit and the gross profit margin, chapter 10, now read as a written-up breakdown from your notes: the book's box with the arrow on gross profit, the two equations with the book's example, what the margin says at 40% and 20%, the margins Warren points to, and your notes as written. The income statement and cost of goods sold chapters now show their arithmetic as equations rather than a chain of boxes, and the revenue chapter's chain reads as numbered instructions. |
| v1.26 | The notes' examples in a section of their own | The companies and margins your notes give as examples now sit in a section of their own, headed Examples from your notes, placed where your notes have them: between the kinds of business and the points on chapter 3, and between the points on gross margin and the rule of thumb on chapter 10, whose parts now run in the order of your notes. A line under the heading says they are the book's examples, from its first edition of 2008 and the 2011 second edition you are reading, and that the figures are of that time. |
| v1.27 | Chapters 12 and 13 written up, costs and research | Selling, general and administrative expenses, chapter 12, and research and development, chapter 13, now read as written-up breakdowns from your notes, in the order you wrote them: what SG&A is and why it must stay low and steady, the test of its share of gross profit with the book's averages and the swings at General Motors and Ford, and what the share says; then the two ways a research-built advantage dies, Microsoft and Google, Merck and Intel against Coca-Cola and Moody's, and why Warren wants a sure thing. |
| v1.28 | Chapter 14 written up, depreciation as a real cost | Depreciation, chapter 14, now reads as a written-up breakdown from your notes, in the order you wrote them: the wearing out of machines and buildings spread over their lives, the book's printing press as the worked example with the three statements it shows up on, Wall Street's EBITDA and why Warren will not look at it, the share of gross profit that depreciation takes at Coca-Cola, Wrigley and Procter & Gamble against General Motors, and the rule that less is always more. |
| v1.29 | Chapter 15 written up, little or no interest | Interest expense, chapter 15, now reads as a written-up breakdown from your notes, in the order you wrote them: the two reasons a company pays a lot of interest, a fiercely competitive industry or a leveraged buyout, the companies Warren wants paying little or none, the book's figures from Procter & Gamble and Wrigley to Goodyear and the airlines, with Wells Fargo as the bank, the test of interest as a share of operating income with its 15% rule, and the lowest in any industry as the likeliest to have the advantage. |
| v1.30 | The price chart under the name, always on show | The share-price chart no longer waits behind a Graph link: it sits under the company's name, above what the company does, drawn as soon as your key is in the box, with the price large above it and the day's change and the time of the quote beside. A Hide graph link folds the chart away and keeps the price on show, and the page remembers your choice. |
| v1.31 | Accounts at Firebase, watchlists that follow you | An Account tab now lets you make an account with your name, surname, a username and a password, and sign in on any device. Your watchlists and chapter notes are kept with the account and meet what is on the device when you sign in, the newer side winning. Every account has the generic My watchlist, you can make custom lists with a description if you like, and adding a company is back: from its own page into any list, or by ticker under a list. Company numbers and your EODHD key stay on the device. The account store waits only for the Firebase project and its key. |
| v1.32 | The book's boxes for six chapters, and chapter 16 | Chapters 11 to 16 now open with the book's own income-statement box from your photographs, the arrow on each chapter's line, down to the interest expense and the gain on the sale of assets. Chapter 16, the gain or loss on the sale of assets and the catch-all other, is written up from your notes: the equation, the book's property as a worked example, and why Warren takes these one-off items out before judging a business. |
| v1.33 | Stock splits on file, the price chart restated | Every company now carries its stock splits from EODHD, fetched with its fundamentals, and the share-price chart divides the prices before each split by its ratio, so a four-for-one no longer reads as a crash. The company page lists the splits under the next report date. The per-share figures in the table needed nothing: EODHD restates them already, as your own pull shows. |
| v1.34 | The month of a split no longer reads as a crash | On the all-time chart the month in which a company split was divided once too often, so Nvidia's June 2024 fell from 109 to 12 and back. Each weekly and monthly bar is now judged by the day its closing price was struck, the end of its week or month, rather than the date the bar is labelled with, and the month of a split reads as it traded. |
| v1.35 | Search by name, a secret key, five more markets | The company box now takes a name as well as a ticker and suggests companies as you type, from everything on file: the arrows and Enter, or a click, open one at once without spending a call, and a typed ticker still fetches as before. Every account now carries a secret key, shown on the Account page with a Copy button, to say a request is yours in an email or the like; if it leaks, one click makes a new one and the old one stops working at once. Your new pull is on the site too: the companies of the Korea Stock Exchange, KOSDAQ, Shanghai, Shenzhen and Xetra now open from their rows and screen beside London, NASDAQ and New York, 17,609 companies with their latest year in all. |
| v1.36 | The list of splits leaves the company page | The Splits line under the next report date is gone: a company with a long history of splits filled three lines with them. The splits themselves stay at work behind the price chart, which still restates earlier prices and says so in the note under it. |
| v1.37 | Your chapter notes under every income-statement line | The analysis under each line of the income statement now comes from your own chapter notes, from revenue down to the one-off gains: the thresholds, the ten-year test of consistency and the book's examples, Coca-Cola and Moody's against General Motors and the airlines, where your notes give them. The lines that had no rule before, revenue, cost of goods sold, gross profit, operating income, interest expense and the one-off gains, carry one now, and the Screen's SG&A rule reads 30% or less, as your notes have it. |
| v1.38 | Every earnings call marked on the price chart | The row of spans above the share-price chart now ends in an Earnings calls box, off until you tick it: ticked, a dashed claret line stands on the chart at every date the company reported its results, before the open or after the close on a daily chart, and hovering a marked day names the call and the quarter it was for. Companies fetched from now on carry their report history; those already on file say so and fill in with a fresh fetch. |
| v1.39 | A slider under the graph, one box for ten years | The graph popup's From and To dropdowns are gone: a two-thumb slider sits under the chart instead, spanning every year or quarter on file, with the range it holds written between its ends, and the window is now a single Last 10 years box that moves the slider to the last ten years when ticked and back to the whole run when not, unticking itself when you move a thumb by hand. The last value's label now sits over its own bar, clear of the bar beside it, instead of printing across it. |
| v1.40 | The income statement finished, with a TL;DR on every chapter | Chapters 17 to 20, income before tax, income taxes paid, net earnings and earnings per share, now read as written-up breakdowns from your notes, with the book's box carried down to net earnings from your photographs, the example calculations you asked for worked on the box's figures, the buyback trick in made-up figures, and the book's two ten-year columns of earnings per share with its reading of each. Every written-up chapter now opens with a TL;DR, the plainest instruction for the reader, in your words where you gave them, and the table's rules for those four lines come from the notes too. |
| v1.41 | The two earnings runs drawn as lines | Chapter 20's two ten-year columns of earnings per share from the book now have line graphs underneath them, drawn at the page's width: the steady climb Warren looks for beside the erratic run he stays away from, its two losses in claret below the zero line, with the year and figure on hover. |
| v1.42 | The bracketed notes are instructions, written into policy | Nothing on the page changed: every instruction in square brackets in your chapter notes, the example calculations for chapters 17 to 19 and the examples from the photographs for chapter 20, was already carried out. The rule itself is now written into the repository's standing policy, so any bracket in a future set of notes is treated as an instruction and a chapter with one unanswered counts as unfinished. |
| v1.43 | The balance sheet opens, the table's rules short again | Chapter 21, the balance sheet in general, now reads as a written-up breakdown from your notes: what a balance sheet is and the two parts of it, with the kinds of asset and liability the book lists, the book's example balance sheet from your photographs drawn as two sides that agree at $43,059, and the net-worth sum worked three ways, the book's $100K business with $25K and then $175K of liabilities, and the sheet's own totals. The rules under the table's lines are short again: one plain line where the book gives a basic instruction, such as 40% and up is good and below 20% is not for the gross margin, and nothing under revenue and the other plain lines, with the chapter page holding the detail. |
| v1.44 | A second look, the controls restyled, a price slider | A switch at the top of the page now offers two looks: Newspaper, the salmon paper the site has had, and Original, drawn from the book's cover, with ivory paper, black ink, the title in the cover's gold Roman capitals, the text in a Garamond like the book's pages, and the burgundy kept for the accents. The buttons and options across the site now follow your input tools, square and hairline with the chosen option filled and every on/off box a switch, and the share-price chart has the same two-thumb slider as the line graphs, narrowing any span to the bars between the thumbs. |
| v1.45 | The cover's lettering, and a switch that moves nothing | The Original masthead is now set the way the cover's title is lettered, slim Garamond capitals widely spaced in the cover's gold, instead of the heavier Roman face of v1.44. Switching between the two looks no longer shifts the page: the title, the subtitle, the headlines and the text keep the same heights and run the same width in either look, so only the lettering changes. |
| v1.46 | The assets and the current asset cycle written up | Chapters 22 and 23, the assets and the current asset cycle, now read as written-up breakdowns from your notes: the book's box of the assets from your photograph, the two kinds of asset with their lines, and the cycle of cash to inventory to receivables and back to cash, with the book's box of the current assets and the arrows on the three lines it runs through. Every switch on the site now shows green when it is on and red when it is off, and your latest export replaces the one on file. |
| v1.47 | Warren Buffett's Analytics, the book's tests on one page | A button above a company's table now opens Warren Buffett's Analytics: a dashboard of tiles, one for each line the finished chapters give a rule for, from the gross margin to earnings per share, each with the last ten years drawn with its trend line, the chapter's TL;DR, and a verdict in the chapter's own terms, such as whether earnings per share have climbed steadily as Warren wants. Revenue and the other lines he does not judge on their own are left out, and more tiles join as more chapters are finished. |
| v1.48 | The analytics as sections, each with its own live graph | Warren Buffett's Analytics now reads section by section, one for each line, with its heading, what Warren looks for in red as under the table's lines, the chapter's TL;DR, and then the graph and the conclusion. Every graph is now as interactive as the ones behind the table: a line or bars, the trend line or the mean band, the last ten years or every year on file with a two-thumb slider to narrow them, and the conclusion follows the years you show. |
