# what-would-warren-say

A static site on Cloudflare Workers: a reading companion for *Warren Buffett
and the Interpretation of Financial Statements* by Mary Buffett and David
Clark, styled like a financial newspaper. A section dropdown narrows the book
to one part, a row of numbered tabs picks the chapter, and the contents page
lists every chapter in two columns. Each chapter has a summary box and a notes
box that save as you type. Export writes everything you have written to a JSON
file, and Import reads one back, so you can carry on another day or on another
device.

There is no build step. The files in `public/` are the site, and the page is a
single self-contained HTML file with its styles and script inline. The only
other files it loads are its own fonts.

## Structure

```
public/
  index.html       contents, section dropdown, chapter tabs and chapter pages (one file, hash routes)
  404.html         not-found page in the same style, links back home
  favicon.svg
  robots.txt
  _headers         security and caching headers
  assets/fonts/    Playfair Display and Newsreader, latin subsets, self-hosted
wrangler.jsonc     assets-only Worker config (no Worker script)
package.json       wrangler as a devDependency, dev/deploy/check scripts
prompt text/       the prompt and reply behind the version in service
CLAUDE.md          standing policy for working in this repo
```

## How the page works

- `#` shows the contents; `#intro` and `#1` to `#57` show a chapter page. The
  section dropdown and the tab row follow whichever chapter is open, and the
  dropdown remembers the last chapter visited in each section.
- What you type is saved in the browser's local storage under the key
  `wwws.entries.v1`, one entry per chapter with `summary`, `notes` and an
  `updated` timestamp. Nothing is sent anywhere.
- Export downloads `what-would-warren-say-YYYY-MM-DD.json`. Import reads such
  a file and merges it in: a chapter from the file replaces the one here unless
  the one here was written more recently, and chapters absent from the file are
  left alone.

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
storage, import, and check the text comes back.

## Deployment

The repository is connected to Cloudflare Workers Builds, so every push to
`main` deploys to production. Connect it once in the Cloudflare dashboard
(Workers & Pages, Create, Import a repository) if that has not been done yet.

## Fonts

Headlines are set in Playfair Display (Claus Eggers Sørensen) and text in
Newsreader (Production Type). Both are published under the SIL Open Font
License 1.1 and are served from `public/assets/fonts/` as latin-subset woff2
files taken from Google Fonts, so the page makes no request to Google at all.
A notice beside them carries the copyright lines and the licence link,
and each file carries the same in its own metadata.

## External resources

None. The page loads nothing from other domains.
