#!/usr/bin/env node
// Copy a pull's screen rows into the site, so every company of the pulled
// venues opens from its row without a key, with its latest year's figures,
// and the Screen has rows to show before the store is filled. Reads
// data/screen/<VENUE>.json and writes public/data/screen/<VENUE>.json plus
// index.json: the venues, how many companies each holds, and every symbol's
// venue. Run it after a pull, then release as usual.
//
//   npm run bundle-screen             # from data/screen/ into public/data/screen/
//   node tools/bundle-screen.mjs [--data data] [--out public/data/screen]

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readJson, writeJson } from './lib/pull.mjs';

const args = parseArgs(process.argv.slice(2));
const DATA = path.resolve(args.data || 'data');
const OUT = path.resolve(args.out || path.join('public', 'data', 'screen'));

const index = readJson(path.join(DATA, 'screen', 'index.json'));
if (!index || !index.venues) { console.error('No screen files at ' + DATA + ': a pull writes them when it finishes.'); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.json')) fs.unlinkSync(path.join(OUT, f));

const venues = {}, symbols = {}, hasYear = {};
let pulledUpTo = '', bytes = 0;
for (const venue of Object.keys(index.venues).sort()) {
  const src = path.join(DATA, 'screen', venue + '.json');
  const rows = readJson(src);
  if (!Array.isArray(rows) || !rows.length) continue;
  fs.copyFileSync(src, path.join(OUT, venue + '.json'));
  bytes += fs.statSync(src).size;
  let withStatements = 0, newest = '';
  for (const r of rows) {
    if (!r || !r.symbol) continue;
    if (r.year) withStatements++;
    if (r.pulledAt > newest) newest = r.pulledAt;
    // a symbol pulled under two venues (a watchlist pull, then its market) points at the one with statements
    if (!symbols[r.symbol] || (r.year && !hasYear[r.symbol])) { symbols[r.symbol] = venue; hasYear[r.symbol] = !!r.year; }
  }
  venues[venue] = { file: venue + '.json', companies: rows.length, withStatements, pulledUpTo: newest };
  if (newest > pulledUpTo) pulledUpTo = newest;
}
writeJson(path.join(OUT, 'index.json'), { builtAt: new Date().toISOString(), pulledUpTo, venues, symbols });
const total = Object.values(venues).reduce((n, v) => n + v.withStatements, 0);
console.log('Bundled ' + Object.keys(venues).length + ' venues, ' + Object.keys(symbols).length + ' companies (' + total + ' with statements, ' + Math.round(bytes / 1e5) / 10 + ' MB) into ' + OUT + '.');
