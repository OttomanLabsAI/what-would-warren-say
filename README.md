# what-would-warren-say

A Cloudflare Workers site: a reading companion for *Warren Buffett and the
Interpretation of Financial Statements* by Mary Buffett and David Clark,
styled like a financial newspaper. Three views sit under the masthead, and
the site opens on Companies.

**Chapters.** A section dropdown narrows the book to one part, a row of
numbered tabs picks the chapter, and the contents page lists every chapter in
two columns. Each chapter has a chapter type, a summary box and a notes box
that save as you type. Export writes everything you have written to a JSON
file, and Import reads one back, so you can carry on another day or on another
device. Chapters the owner has finished are written up instead: the boxes give
way to a breakdown of the chapter, a thesis, diagrams, the points, the book's
own income-statement box where the chapter has one, and the owner's notes as
written; the raw export behind them is kept under `notes/`.

**Companies.** Every company of NASDAQ, NYSE and London opens without a key.
Eighty come bundled with their full history as sample data; the rest open
from the bundled screen rows with their latest year's figures, the lines the
row does not hold left blank with a note, as is the share price without a
key. Once the store, an R2 bucket in your Cloudflare account, is filled, every
company opens with its full history. With your own EODHD API token the page
fetches any company's fundamentals live. Under the company's name sits what it
does, EODHD's business description with the website, head count, listing year
and country beside it, three lines at a time with More for the rest. Either way it lays out the yearly history of the figures
the book walks through: every statement line with the chapter beside it, and
under the income-statement lines and the ratios the rule of thumb, drawn from
the chapter notes for the chapters written up so far, from revenue to the
one-off gains, with the book's thresholds and examples. With a token in the box
the company's current share price sits above the table, with the day's change
and a Graph link that draws the price over the last day, week, month, six
months, year, five years, ten years or all time. Fetched companies are
kept on the device, the table downloads as CSV, and an expandable section
lists every field EODHD reported.

**Screen.** Every company of a venue in the store, one row each with the
latest year's figures and the book's ratios: sortable by any column,
searchable by name or ticker, with the book's rules of thumb as tick-box
filters, from a gross margin of 40% or more to buying back shares, and a
count of the rules each company meets.

**Watchlists.** Named lists of companies, each company with its EODHD ticker:
a generic list and a set of custom lists come filled in, and lists can be
made, renamed, trimmed and deleted. A company's name opens its numbers.
Adding a company to a list is set aside for now and will come later.

There is no build step. The files in `public/` are the site, and the page is a
single self-contained HTML file with its styles and script inline. The only
other files it loads are its own fonts. A tiny Worker, `src/worker.js`, relays
the page's EODHD requests on the same origin; everything else is served as a
static asset by that Worker's assets binding.

## Structure

```
public/
  index.html       all five views: companies, screen, watchlists, contents, dropdown, chapter tabs, chapter pages, account (one file, hash routes)
  data/            sample data: index.json and companies/<SYMBOL>.json, written by tools/bundle-samples.mjs
  data/screen/     the pull's screen rows per venue and an index, written by tools/bundle-screen.mjs
  404.html         not-found page in the same style, links back home
  favicon.svg
  robots.txt
  _headers         security and caching headers
  assets/fonts/    Playfair Display and Newsreader, latin subsets, self-hosted
src/worker.js      the EODHD relay and the store; every other request goes to the assets
wrangler.jsonc     Worker + assets config, and the store's bucket binding
package.json       wrangler as a devDependency, dev/deploy/check/pull/upload scripts
tools/             the puller, the local pull page and the store uploader (see below)
notes/             the owner's exported notes, raw: the source of the written-up chapters
firebase/          the account store: the Firestore security rules and the project files
prompt text/       the prompt and reply behind the version in service
CLAUDE.md          standing policy for working in this repo
```

## How the page works

- `#` and `#companies` show the Companies view, `#companies/KO.US` a company:
  the kept copy if you fetched it, else the store's copy if the company is
  there, else the sample file if there is one, else its bundled screen row
  with the latest year only, else
  the form filled in. `#numbers` and `#numbers/KO.US` still work as the old
  addresses.
- `#chapters` shows the contents; `#intro` and `#1` to `#57` show a chapter
  page. The section dropdown and the tab row follow whichever chapter is
  open, and the dropdown remembers the last chapter visited in each section.
- The sample data lives under `public/data/`: `index.json` lists the
  companies and `companies/<SYMBOL>.json` holds each one in the shape the
  page keeps. `npm run bundle-samples` rebuilds both from a pull in `data/`.
  A sample company's page says so, offers "Fetch a live copy", and a fetched
  copy then takes its place.
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

## The Companies view and EODHD

- The page calls `/api/eodhd/fundamentals/<SYMBOL>` on its own origin with the
  token in an `X-Api-Token` header. The Worker forwards that to
  `https://eodhd.com/api/fundamentals/<SYMBOL>?api_token=…&fmt=json` and passes
  the reply and its status straight back. Nothing is cached or logged there,
  and the Worker holds no secret of its own. The price line and its chart use
  three more EODHD paths the same way: `real-time/<SYMBOL>` for the quote,
  `eod/<SYMBOL>` for daily, weekly and monthly closes, and
  `intraday/<SYMBOL>` for the day of five-minute bars; a fetch also asks
  `splits/<SYMBOL>` for the company's split history. The Worker forwards
  only those five paths, on GET, and of the query only `from`, `to`,
  `period`, `interval` and `order` in their expected shapes.
- The quote is one call and is kept for a quarter of an hour; each span of
  the chart is one call, except the day of five-minute bars, which EODHD
  counts as five. Prices are never stored and never exported.
- The company box takes a name as well as a ticker and suggests companies
  as you type, from everything on file: the arrows and Enter, or a click,
  open one without a call. A typed ticker fetches as before.
- Symbols take EODHD's form, `CODE.EXCHANGE` (`KO.US`, `VOD.LSE`); a bare US
  code gets `.US`. One fetch is eleven EODHD API calls, ten for the
  fundamentals and one for the split history, so companies are kept on
  the device under `wwws.numbers.v1` (the eight most recent) and shown again
  without a call.
- Stock splits: each company keeps its split history from EODHD, and the
  price chart divides every bar before a split by the splits since, so a
  four-for-one no longer reads as a crash; the note under the chart names
  the splits it is restated for. A company without the list on file asks for it once when its chart
  is drawn. EODHD's per-share figures, the shares outstanding and the
  earnings per share, come restated for later splits already, so the table
  is left as it comes. The token is kept under `wwws.eodhd.token` only when
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
- Under the company's name a line gives the next report EODHD lists: the
  date, whether it comes before or after the market, the quarter it covers
  and the analysts' estimate; a date that has passed says so.
- Every line of the table has a small graph button. It opens a popup chart of
  that line: line or bar, by fiscal year or by quarter (year-based ratios use
  the trailing four quarters), with a from-to range, presets for the last 5
  and 10 years, an optional straight trend line or a mean band one standard
  deviation wide, a hover readout, and under the chart the figures for the
  period shown: mean, median, standard deviation, variance, coefficient of
  variation, low and high, trend per period and its fit, change first to
  last, compound growth a year, falls on the period before and the largest
  fall. The chart is drawn as inline SVG, so the page still loads nothing
  from elsewhere.
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
storage, import, and check the text comes back; for the Companies view, answer
the relay path from a fixture shaped like an EODHD reply and check the table;
for the store and the Screen, answer `/api/data/…` from the screen files of a
pull and stand-in company files. For a change to the Worker, run `npx wrangler
dev --var EODHD_BASE:<mock url>` against a local mock of EODHD and exercise
`/api/eodhd/…` and the assets, and seed the local bucket (`npx wrangler r2
object put wwws-data/<key> --file … --local --persist-to <dir>`, then `dev
--persist-to <dir>`) to exercise `/api/data/…`.

## Pulling whole exchanges

Two ways to pull, sharing one engine in `tools/lib/pull.mjs`, both on your own
machine, apart from the site, into a local `data/` folder that git ignores.
They need Node 18 or later and nothing else.

**The page.** `npm run pull-app` starts a page on 127.0.0.1 and opens it: a
dropdown of markets (NASDAQ, NYSE, London, Shanghai, Shenzhen, Korea, KOSDAQ,
Xetra, or all of them), a dropdown of the sample watchlists from the site, a
box for the token with a "remember on this machine" tick (the token then
lives in `data/eodhd-token.txt`, never in the repository), a Start and a Stop
button, a progress bar, the calls spent this run, and EODHD's own count of
calls used today before and after the run. Pass `--port`, `--out`, `--base`
or `--no-open` if the defaults do not suit.

**Rebuilding without calls.** The extraction gains fields over time, the
business description among them, and the raw replies on disk already hold
them: the pull page's **Rebuild from saved replies** button, or
`npm run pull -- --reextract`, writes every company's file and row again
from those replies, spending nothing, and rewrites the screen files. Run it
after updating the tools, then bundle and release as usual.

**Splits for a pull made before them.** Every pull now fetches each
company's split history with its fundamentals. For companies pulled before
that, the page's **Fetch splits** button, or `npm run pull -- --splits`,
asks EODHD for the split history of every company on disk without one, one
call each, and stops on the day's limit like a pull.

**The command line.** `tools/pull-fundamentals.mjs` does the same without a
page:

```bash
EODHD_TOKEN=your-token npm run pull                      # NASDAQ and NYSE, London, Shanghai, Shenzhen, Korea, Xetra
EODHD_TOKEN=your-token npm run pull -- --exchanges US,LSE --refresh 30
```

Each company costs eleven EODHD calls, ten for its fundamentals and one for
its split history, and each symbol list one, so the seven
lists, around seventeen thousand companies, take two days of a 100,000-call
allowance: the run stops on its own when the day's calls are spent and carries
on where it was when run again. It keeps EODHD's raw replies for each company,
gzipped, writes the company in the shape the Numbers page keeps, its splits
included, one row of
the book's ratios for the latest year, and a screen file per venue, as JSON
for the site and as CSV for a spreadsheet. The options are listed at the top
of the script. The token comes from the
environment and never enters the repository or the site.

## The store: sending a pull to the site

Until the store exists the site carries the pull's screen rows itself:
`npm run bundle-screen` copies `data/screen/<VENUE>.json` into
`public/data/screen/` with an index of the venues and every symbol's venue,
and the page opens any company from its row and lists them in the Screen.

The full pull is read from a store of your own: an R2 bucket named
`wwws-data` in the same Cloudflare account the site runs in, bound to the
Worker as `DATA` and served on the site's own origin at `/api/data/…`, open
to anyone, with no key. Make the bucket once in the Cloudflare dashboard
(R2 Object Storage, Create bucket, the name above); then uncomment the
`r2_buckets` line in `wrangler.jsonc` and release. A deploy that carries the
binding before the bucket exists fails, which is why the line is commented
out for now.

Then send a pull up, either from the pull page's second form, **Send to the
site**, or from the command line:

```bash
R2_ENDPOINT=https://<account id>.r2.cloudflarestorage.com \
R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… npm run upload-store      # add -- --all to resend everything
```

The keys are those of an R2 API token: in the dashboard open R2, then Manage
R2 API Tokens, create a token with Object Read & Write on the bucket, and it
shows the endpoint, the Access Key ID and the Secret Access Key. The page
keeps them in memory, or in `data/r2.json` when you tick "remember"; they
never enter the repository or the site. Only what the site reads goes up:
each company with statements (`companies/<SYMBOL>.json`), the screen rows per
venue and their index (`screen/…`), and `index.json`, which lists the
companies and venues in the store and is written last, so the site never
points at a file that is not there yet. The raw replies, the rows folder and
the CSVs stay on your machine. `data/uploaded.json` remembers what went up,
so a second send skips companies the pull has not touched since. The free R2
allowance is ten gigabytes, which holds the three exchanges several times over.

EODHD's personal plans do not allow the data to be redistributed. The store is
open because the site has no readers but its owner yet; if that changes, put
Cloudflare Access in front of the data paths on a domain of your own.

## Deployment

The repository is connected to Cloudflare Workers Builds, so every push to
`main` deploys to production. Connect it once in the Cloudflare dashboard
(Workers & Pages, Create, Import a repository) if that has not been done yet.
The Worker needs no secrets. Its one binding beyond the assets, the store's
bucket `wwws-data`, is commented out in `wrangler.jsonc` until the bucket
exists in the account; a deploy with the binding and no bucket fails.

## Fonts

Headlines are set in Playfair Display (Claus Eggers Sørensen) and text in
Newsreader (Production Type). Both are published under the SIL Open Font
License 1.1 and are served from `public/assets/fonts/` as latin-subset woff2
files taken from Google Fonts, so the page makes no request to Google at all.
A notice beside them carries the copyright lines and the licence link,
and each file carries the same in its own metadata.

## Accounts

The Account tab makes an account with a name, a surname, a username and a
password, and signs in on any device. An account keeps the reader's
watchlists, each with a voluntary description, and their chapter notes;
the generic My watchlist is always there, and a company can be added to
any list from its own page or by ticker under a list. Company numbers and
the EODHD key never leave the device.

Every account carries a secret key, shown on the Account page with a Copy
button: it says a request is the reader's own, in an email for instance.
If it leaks, "Make a new key" replaces it at once and the old one stops
working. The key is kept in the reader's profile, readable by them alone,
and never travels in an export.

The accounts live at Firebase: Authentication (email and password under
the hood, the username becoming an address at a reserved domain that is
never mailed) and Firestore, both spoken to over their REST APIs straight
from the page, with no SDK. `firebase/firestore.rules` keeps every reader
to their own documents and checks their shapes; `firebase/firebase.json`
points at the rules and sets the emulator ports.

To switch accounts on, once:

1. Make a Firebase project, enable Email/Password under Authentication,
   and create a Firestore database.
2. Deploy the rules: `npx firebase-tools deploy --only firestore:rules
   --project <project id> --config firebase/firebase.json`.
3. Put the project's web API key and project id in `FIREBASE` near the
   top of the accounts section of `public/index.html`, and release.

Until then the Account tab says accounts are not switched on, and
everything stays on the device and travels in exports. To verify a change
to the accounts or the rules, run the Firebase emulators (they need Java):
`npx firebase-tools emulators:exec --only auth,firestore --project
demo-wwws --config firebase/firebase.json "<a script that drives the
page>"`, the page given the emulator hosts in `window.WWWS_FIREBASE`.

## External resources

The page itself loads nothing from other domains. The Companies view calls
EODHD through the site's own relay: the fundamentals when you press Fetch,
and the price and its chart once a token is in the box. With accounts
switched on, the page also calls Firebase's Identity Toolkit, securetoken
and Firestore APIs, only when signing in and syncing.
