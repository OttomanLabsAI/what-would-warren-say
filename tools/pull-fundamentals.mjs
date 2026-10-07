#!/usr/bin/env node
// Pull every company's fundamentals for a set of exchanges from EODHD, on your
// own machine and apart from the site, into a local data folder the site can
// later be fed from. Needs Node 18 or later and nothing else. The engine lives
// in tools/lib/pull.mjs and is shared with the local page, tools/pull-app.mjs.
//
//   EODHD_TOKEN=your-token node tools/pull-fundamentals.mjs [options]
//
// Options
//   --out <dir>             where to write; default data (git ignores it)
//   --exchanges US,LSE,SHG,SHE,KO,KQ,XETRA
//                           EODHD exchange codes to pull; default as shown: the
//                           United States, London, Shanghai, Shenzhen, the Korea
//                           Stock Exchange, KOSDAQ and Xetra for Germany
//   --us NASDAQ,NYSE        which venues to keep from the US list; default as shown
//   --refresh <days>        pull again any company pulled more than this many days
//                           ago; without it, a company already on disk is skipped
//   --only A.US,B.LSE       pull just these symbols, whatever the lists say
//   --limit <n>             pull at most n companies this run
//   --parallel <n>          fetches in flight at once; default 4
//   --screen-only           rebuild the screen files from what is on disk, no fetching
//   --recompute             rebuild every company's screen row from its file first
//   --base <url>            EODHD's base; default https://eodhd.com/api/
//
// Each company costs ten EODHD calls and each symbol list one. A run stops on
// its own when the day's calls are spent (EODHD answers 402) and carries on
// from where it was when run again, so an exchange that will not fit in one
// day's allowance is pulled over two.
//
// What lands under --out
//   symbols.json            the universe: every company kept, with name and venue
//   pulled.json             per symbol: when it was pulled and how it went
//   raw/<SYMBOL>.json.gz    EODHD's reply, byte for byte, gzipped
//   companies/<SYMBOL>.json the company in the shape the Numbers page keeps
//   rows/<SYMBOL>.json      the book's ratios for the latest year, one row
//   screen/<VENUE>.json     the rows of one venue, for screening in the browser
//   screen/<VENUE>.csv      the same rows for a spreadsheet
//   screen/index.json       the screen files, their counts and dates

import { createContext, loadUniverse, pull, writeScreens, recomputeRows, parseArgs, DEFAULT_EXCHANGES, DEFAULT_US } from './lib/pull.mjs';

const args = parseArgs(process.argv.slice(2));
const TOKEN = process.env.EODHD_TOKEN || '';

main().catch(e => { console.error('Stopped: ' + (e && e.message ? e.message : e)); process.exit(1); });

async function main() {
  const ctx = createContext({
    out: args.out || 'data',
    base: args.base,
    token: TOKEN,
    exchanges: String(args.exchanges || DEFAULT_EXCHANGES.join(',')).split(',').map(s => s.trim()).filter(Boolean),
    usKeep: String(args.us || DEFAULT_US.join(',')).split(',').map(s => s.trim()).filter(Boolean),
    parallel: parseInt(args.parallel || '4', 10) || 4,
    limit: args.limit ? parseInt(args.limit, 10) : Infinity,
    refreshDays: args.refresh ? parseFloat(args.refresh) : null,
    only: args.only ? String(args.only).split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : null,
    log: console.log,
    onProgress: (p) => { if (p.done % 25 === 0) console.log(p.done + ' of ' + p.total + ' (' + p.ok + ' ok, ' + p.missing + ' missing, ' + p.refused + ' refused, ' + p.error + ' errors)'); }
  });
  if (args.recompute) recomputeRows(ctx);
  if (!args['screen-only']) {
    if (!TOKEN) throw new Error('set EODHD_TOKEN to your EODHD API token');
    const universe = await loadUniverse(ctx);
    await pull(ctx, universe);
  }
  writeScreens(ctx);
}
