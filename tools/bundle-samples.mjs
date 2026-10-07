#!/usr/bin/env node
// Copy the companies of a pull into the site as sample data, so the Companies
// page can show them without calling EODHD. Reads data/pulled.json and
// data/companies/, keeps every company that came back with statements, and
// writes public/data/companies/<SYMBOL>.json plus public/data/index.json.
// Run it after a pull, then release as usual.
//
//   npm run bundle-samples            # from data/ into public/data/
//   node tools/bundle-samples.mjs [--data data] [--out public/data]

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readJson, writeJson } from './lib/pull.mjs';

const args = parseArgs(process.argv.slice(2));
const DATA = path.resolve(args.data || 'data');
const OUT = path.resolve(args.out || path.join('public', 'data'));

const manifest = readJson(path.join(DATA, 'pulled.json'));
if (!manifest) { console.error('No pull found at ' + DATA + ': run a pull first.'); process.exit(1); }

fs.mkdirSync(path.join(OUT, 'companies'), { recursive: true });
for (const f of fs.readdirSync(path.join(OUT, 'companies'))) fs.unlinkSync(path.join(OUT, 'companies', f));

const companies = [];
let skipped = 0;
for (const symbol of Object.keys(manifest).sort()) {
  const m = manifest[symbol];
  if (m.status !== 'ok') continue;
  const c = readJson(path.join(DATA, 'companies', symbol + '.json'));
  if (!c) continue;
  const years = new Set([...Object.keys(c.income || {}), ...Object.keys(c.balance || {}), ...Object.keys(c.cashflow || {})]);
  if (!years.size) { skipped++; continue; }
  fs.copyFileSync(path.join(DATA, 'companies', symbol + '.json'), path.join(OUT, 'companies', symbol + '.json'));
  companies.push({ symbol, name: c.meta && c.meta.name ? c.meta.name : m.name, exchange: m.exchange, currency: c.meta && c.meta.currency ? c.meta.currency : m.currency, pulledAt: m.pulledAt, years: years.size });
}
const pulledUpTo = companies.reduce((t, c) => c.pulledAt > t ? c.pulledAt : t, '');
writeJson(path.join(OUT, 'index.json'), { builtAt: new Date().toISOString(), pulledUpTo, companies });
const bytes = companies.reduce((n, c) => n + fs.statSync(path.join(OUT, 'companies', c.symbol + '.json')).size, 0);
console.log('Bundled ' + companies.length + ' companies (' + Math.round(bytes / 1e5) / 10 + ' MB) into ' + OUT + (skipped ? '; left out ' + skipped + ' with no statements' : '') + '.');
