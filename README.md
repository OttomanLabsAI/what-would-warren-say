# what-would-warren-say

A static site on Cloudflare Workers. Right now it is one page: the chapter
list of *Warren Buffett and the Interpretation of Financial Statements* by
Mary Buffett and David Clark, grouped the way the book groups them.

There is no build step. The files in `public/` are the site.

## Structure

```
public/
  index.html       the chapter list
  404.html         not-found page, links back home
  favicon.svg
  robots.txt
  _headers         security and caching headers
wrangler.jsonc     assets-only Worker config (no Worker script)
package.json       wrangler as a devDependency, dev/deploy/check scripts
prompt text/       the prompt and reply behind the version in service
CLAUDE.md          standing policy for working in this repo
```

## Local development

```bash
npm install
npm run dev          # serves public/ with wrangler dev
```

## Verification before a release

```bash
npm run check                         # wrangler deploy --dry-run
```

Then serve `public/` and render it with headless Chromium at desktop and
mobile widths, and look at the screenshots.

## Deployment

The repository is connected to Cloudflare Workers Builds, so every push to
`main` deploys to production. Connect it once in the Cloudflare dashboard
(Workers & Pages, Create, Import a repository) if that has not been done yet.

## External resources

None. The page loads nothing from other domains.
