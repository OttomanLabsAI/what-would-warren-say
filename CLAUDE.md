# CLAUDE.md

Standing policy for this repository. Read it before making any change here.

## What this repo is

A Cloudflare Workers static-assets site. Everything served lives in `public/`
and there is no build step - the files in that directory are the site. The repo
is connected to Cloudflare Workers Builds, so **every push to `main` deploys to
production**.

```
public/            everything served
  index.html       contents, section dropdown, chapter tabs, chapter pages: one file
  404.html         same masthead and palette as index.html
  favicon.svg
  _headers         security + caching headers
  robots.txt
  assets/fonts/    Playfair Display + Newsreader woff2 (OFL), the only assets
wrangler.jsonc     assets-only config, no Worker script
package.json       wrangler devDependency + dev/deploy/check scripts
prompt text/       the records behind the version in service (see below)
```

## How the page works

`index.html` is a single file with its styles and script inline: hash routes
(`#` contents, `#intro`, `#1` to `#57`), a section dropdown whose change opens
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

The look is a financial newspaper: paper `#FFF1E5`, ink `#33302E`, claret
`#990F3D` for accents, teal `#0D7680` for links, Playfair Display for the
masthead and headlines, Newsreader for text, the system sans for controls. The
fonts are self-hosted under `public/assets/fonts/`; they never change, which is
what the immutable cache on `/assets/*` is for. Anything else moved under
`/assets/` needs a fingerprinted name. Keep `index.html` single-file.

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
otherwise) and any input images or files the owner provided. The files are
owner-supplied records: never edit, reformat, trim or regenerate them.

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
