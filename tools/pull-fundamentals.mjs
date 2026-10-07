#!/usr/bin/env node
// Pull every company's fundamentals for a set of exchanges from EODHD, on your
// own machine and apart from the site, into a local data folder the site can
// later be fed from. Needs Node 18 or later and nothing else.
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
//   screen/index.json       the screen files, their counts and dates
//
// The company shape, the next-report rule and the ratio formulas mirror
// extractCompany, nextReport and NUMBER_ROWS in public/index.html: change them together.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';

const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(args.out || 'data');
const BASE = String(args.base || 'https://eodhd.com/api/').replace(/\/?$/, '/');
const EXCHANGES = String(args.exchanges || 'US,LSE,SHG,SHE,KO,KQ,XETRA').split(',').map(s => s.trim()).filter(Boolean);
const US_KEEP = new Set(String(args.us || 'NASDAQ,NYSE').split(',').map(s => s.trim()).filter(Boolean));
const PARALLEL = Math.max(1, parseInt(args.parallel || '4', 10) || 4);
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const REFRESH_DAYS = args.refresh ? parseFloat(args.refresh) : null;
const ONLY = args.only ? String(args.only).split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : null;
const TOKEN = process.env.EODHD_TOKEN || '';
const CALLS_PER_COMPANY = 10;

main().catch(e => { console.error('Stopped: ' + (e && e.message ? e.message : e)); process.exit(1); });

async function main() {
  for (const d of ['raw', 'companies', 'rows', 'screen']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
  const manifest = readJson(path.join(OUT, 'pulled.json')) || {};

  if (args.recompute) {
    let n = 0;
    for (const symbol of Object.keys(manifest)) {
      const c = readJson(path.join(OUT, 'companies', symbol + '.json'));
      if (!c) continue;
      writeJson(path.join(OUT, 'rows', symbol + '.json'), screenRow(manifest[symbol], c));
      n++;
    }
    console.log('Recomputed ' + n + ' rows.');
  }

  if (!args['screen-only']) {
    if (!TOKEN) throw new Error('set EODHD_TOKEN to your EODHD API token');
    const universe = await loadUniverse(manifest);
    await pull(universe, manifest);
  }

  writeScreens(manifest);
}

// ---- the universe -----------------------------------------------------------

async function loadUniverse(manifest) {
  const file = path.join(OUT, 'symbols.json');
  let symbols;
  if (ONLY) {
    symbols = ONLY.map(symbol => manifest[symbol] ? { symbol, ...pick(manifest[symbol]) } : { symbol, code: symbol.split('.')[0], name: symbol, exchange: symbol.split('.').pop(), list: symbol.split('.').pop(), currency: '' });
  } else {
    symbols = [];
    for (const list of EXCHANGES) {
      const r = await eodhd('exchange-symbol-list/' + encodeURIComponent(list) + '?type=common_stock');
      if (r.status !== 200) throw new Error(describe(r.status, 'the symbol list for ' + list));
      const rows = JSON.parse(r.text);
      if (!Array.isArray(rows)) throw new Error('the symbol list for ' + list + ' is not a list');
      let kept = 0;
      for (const s of rows) {
        if (!s || !s.Code) continue;
        const venue = String(s.Exchange || list);
        if (list === 'US' && !US_KEEP.has(venue)) continue;
        symbols.push({ symbol: s.Code + '.' + list, code: String(s.Code), name: String(s.Name || s.Code), exchange: venue, list, currency: String(s.Currency || ''), country: String(s.Country || ''), isin: String(s.Isin || '') });
        kept++;
      }
      console.log(list + ': ' + rows.length + ' common stocks listed, ' + kept + ' kept');
    }
    writeJson(file, { listedAt: new Date().toISOString(), exchanges: EXCHANGES, us: Array.from(US_KEEP), symbols });
  }
  return symbols;
}

function pick(m) {
  return { code: m.code, name: m.name, exchange: m.exchange, list: m.list, currency: m.currency };
}

// ---- the pull --------------------------------------------------------------

async function pull(universe, manifest) {
  const now = Date.now();
  const due = universe.filter(s => {
    const m = manifest[s.symbol];
    if (!m) return true;
    if (m.status === 'error') return true;
    if (REFRESH_DAYS !== null && m.pulledAt && (now - Date.parse(m.pulledAt)) / 86400000 > REFRESH_DAYS) return true;
    return false;
  }).slice(0, LIMIT);
  console.log(universe.length + ' companies in the universe, ' + due.length + ' to pull' + (Number.isFinite(LIMIT) ? ' this run' : '') + '.');
  if (!due.length) return;

  let next = 0, done = 0, calls = 0, stop = null, refusedInARow = 0;
  const counts = { ok: 0, missing: 0, refused: 0, error: 0 };
  const save = () => writeJson(path.join(OUT, 'pulled.json'), manifest);
  const onExit = () => { save(); process.exit(130); };
  process.on('SIGINT', onExit);

  async function worker() {
    while (!stop && next < due.length) {
      const s = due[next++];
      let r = null, failure = '';
      try {
        r = await eodhd('fundamentals/' + encodeURIComponent(s.symbol));
      } catch (e) {
        failure = e && e.message ? e.message : String(e);
      }
      calls += CALLS_PER_COMPANY;
      if (failure) {
        manifest[s.symbol] = entry(s, 'error', failure);
        counts.error++;
      } else if (r.status === 200) {
        let data;
        try { data = JSON.parse(r.text); } catch (e) { data = null; }
        if (!data || typeof data !== 'object') {
          manifest[s.symbol] = entry(s, 'error', 'EODHD sent back something that is not JSON');
          counts.error++;
        } else {
          fs.writeFileSync(path.join(OUT, 'raw', s.symbol + '.json.gz'), zlib.gzipSync(r.text));
          const c = extractCompany(s.symbol, data);
          writeJson(path.join(OUT, 'companies', s.symbol + '.json'), c);
          manifest[s.symbol] = entry(s, 'ok', '', r.text.length, c);
          writeJson(path.join(OUT, 'rows', s.symbol + '.json'), screenRow(manifest[s.symbol], c));
          counts.ok++;
          refusedInARow = 0;
        }
      } else if (r.status === 404) {
        manifest[s.symbol] = entry(s, 'missing', 'EODHD has no fundamentals under this symbol');
        counts.missing++;
        refusedInARow = 0;
      } else if (r.status === 403) {
        manifest[s.symbol] = entry(s, 'refused', 'the plan does not cover this symbol');
        counts.refused++;
        if (++refusedInARow >= 5) stop = describe(403, 'five companies in a row');
      } else if (r.status === 401 || r.status === 402) {
        stop = describe(r.status, s.symbol);
        continue; // not pulled and not counted: it waits for the next run
      } else {
        manifest[s.symbol] = entry(s, 'error', 'EODHD answered ' + r.status);
        counts.error++;
      }
      done++;
      if (done % 25 === 0) { save(); console.log(done + ' of ' + due.length + ' (' + counts.ok + ' ok, ' + counts.missing + ' missing, ' + counts.refused + ' refused, ' + counts.error + ' errors)'); }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  process.off('SIGINT', onExit);
  save();

  const remaining = due.length - done;
  console.log('Pulled ' + counts.ok + ', missing ' + counts.missing + ', refused ' + counts.refused + ', errors ' + counts.error + '; about ' + calls + ' EODHD calls spent this run.');
  if (stop) console.log('Stopped early: ' + stop + (remaining ? ' ' + remaining + ' companies are left for the next run.' : ''));
  else if (remaining) console.log(remaining + ' companies are left for the next run.');
}

function entry(s, status, note, bytes, c) {
  const e = { code: s.code, name: s.name, exchange: s.exchange, list: s.list, currency: s.currency, pulledAt: new Date().toISOString(), status, note: note || '' };
  if (bytes) e.bytes = bytes;
  if (c && c.meta) { e.name = c.meta.name || e.name; e.currency = c.meta.currency || e.currency; }
  return e;
}

function describe(status, what) {
  if (status === 401) return 'EODHD does not recognise the token (401) on ' + what + '.';
  if (status === 402) return 'the day’s EODHD calls are spent (402) at ' + what + '; run again when the allowance resets.';
  if (status === 403) return 'EODHD refused ' + what + ' (403): the plan does not cover it.';
  if (status === 404) return 'EODHD has nothing at ' + what + ' (404).';
  return 'EODHD answered ' + status + ' on ' + what + '.';
}

// one request to EODHD, retried on the rate limit, server errors and network failures
async function eodhd(pathAndQuery) {
  const url = new URL(pathAndQuery, BASE);
  url.searchParams.set('api_token', TOKEN);
  url.searchParams.set('fmt', 'json');
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { accept: 'application/json' } });
    } catch (e) {
      if (attempt >= 4) throw new Error('could not reach EODHD: ' + (e && e.message ? e.message : e));
      await sleep(2000 * attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 4) throw new Error('EODHD kept answering ' + res.status);
      await sleep(5000 * attempt);
      continue;
    }
    return { status: res.status, text: await res.text() };
  }
}

// ---- the company shape, as the Numbers page keeps it -------------------------

const MAX_QUARTERS = 40;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function datedRows(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const d of Object.keys(obj)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && obj[d] && typeof obj[d] === 'object') out[d] = obj[d];
  return out;
}

function yearlyOf(section) {
  return datedRows(section && typeof section === 'object' && section.yearly);
}

function quarterlyOf(section) {
  const all = datedRows(section && typeof section === 'object' && section.quarterly);
  const out = {};
  for (const d of Object.keys(all).sort().slice(-MAX_QUARTERS)) out[d] = all[d];
  return out;
}

function readShares(src, into) {
  if (!src || typeof src !== 'object') return;
  for (const k of Object.keys(src)) {
    const r = src[k];
    if (!r || typeof r !== 'object') continue;
    const d = r.dateFormatted || r.date;
    let n = num(r.shares);
    if (n === null && r.sharesMln !== undefined) { const m = num(r.sharesMln); n = m === null ? null : m * 1e6; }
    if (d && n) into[String(d)] = n;
  }
}

function readEps(src, into) {
  if (!src || typeof src !== 'object') return;
  for (const k of Object.keys(src)) {
    const r = src[k];
    if (!r || typeof r !== 'object' || !r.date) continue;
    const e = num(r.epsActual);
    if (e !== null) into[String(r.date)] = e;
  }
}

// the earliest report still to come: a History entry with a report date and no actual figure yet
function nextReport(src) {
  if (!src || typeof src !== 'object') return null;
  let best = null;
  for (const k of Object.keys(src)) {
    const r = src[k];
    if (!r || typeof r !== 'object' || !r.reportDate || num(r.epsActual) !== null) continue;
    if (!best || String(r.reportDate) < best.date) {
      best = { date: String(r.reportDate), quarter: String(r.date || ''), when: String(r.beforeAfterMarket || ''), estimate: num(r.epsEstimate) };
    }
  }
  return best;
}

function extractCompany(symbol, data) {
  const fin = data.Financials || {};
  const g = data.General && typeof data.General === 'object' ? data.General : {};
  const c = {
    symbol,
    fetchedAt: new Date().toISOString(),
    meta: {
      code: String(g.Code || symbol),
      name: String(g.Name || symbol),
      exchange: String(g.Exchange || ''),
      currency: String(g.CurrencyCode || (fin.Income_Statement && fin.Income_Statement.currency_symbol) || ''),
      fiscalYearEnd: String(g.FiscalYearEnd || ''),
      sector: String(g.Sector || ''),
      industry: String(g.Industry || '')
    },
    income: yearlyOf(fin.Income_Statement),
    balance: yearlyOf(fin.Balance_Sheet),
    cashflow: yearlyOf(fin.Cash_Flow),
    incomeQ: quarterlyOf(fin.Income_Statement),
    balanceQ: quarterlyOf(fin.Balance_Sheet),
    cashflowQ: quarterlyOf(fin.Cash_Flow),
    shares: {},
    sharesQ: {},
    eps: {},
    epsQ: {},
    next: null
  };
  readShares(data.outstandingShares && data.outstandingShares.annual, c.shares);
  readShares(data.outstandingShares && data.outstandingShares.quarterly, c.sharesQ);
  readEps(data.Earnings && data.Earnings.Annual, c.eps);
  readEps(data.Earnings && data.Earnings.History, c.epsQ);
  c.next = nextReport(data.Earnings && data.Earnings.History);
  return c;
}

// ---- the book's ratios for the latest year ---------------------------------

function yearList(c) {
  const seen = {};
  for (const st of [c.income, c.balance, c.cashflow]) for (const d of Object.keys(st || {})) seen[d] = true;
  return Object.keys(seen).sort();
}

function sharesFor(c, date) {
  const row = c.balance[date];
  const n = row ? num(row.commonStockSharesOutstanding) : null;
  if (n) return n;
  if (c.shares[date]) return c.shares[date];
  const year = date.slice(0, 4);
  let found = null;
  for (const d of Object.keys(c.shares)) if (d.slice(0, 4) === year) found = c.shares[d];
  return found;
}

function yearData(c, dates, i) {
  const d = dates[i];
  return {
    date: d,
    inc: c.income[d] || {},
    bal: c.balance[d] || {},
    cf: c.cashflow[d] || {},
    prevBal: i > 0 ? (c.balance[dates[i - 1]] || {}) : {},
    shares: sharesFor(c, d),
    eps: Object.prototype.hasOwnProperty.call(c.eps, d) ? c.eps[d] : null
  };
}

function v(row, ...keys) {
  for (const k of keys) { const n = num(row[k]); if (n !== null) return n; }
  return null;
}
function div(a, b) { return (a === null || b === null || !b) ? null : a / b; }
function sub(a, b) { return (a === null || b === null) ? null : a - b; }
function grossProfit(y) {
  const g = v(y.inc, 'grossProfit');
  return g !== null ? g : sub(v(y.inc, 'totalRevenue'), v(y.inc, 'costOfRevenue'));
}
function capex(y) { const c = v(y.cf, 'capitalExpenditures'); return c === null ? null : Math.abs(c); }
function epsOf(y) { return y.eps !== null ? y.eps : div(v(y.inc, 'netIncome'), y.shares); }

function screenRow(m, c) {
  const dates = yearList(c);
  const row = { symbol: c.symbol, name: m.name, exchange: m.exchange, currency: c.meta.currency, sector: c.meta.sector, industry: c.meta.industry, fiscalYearEnd: c.meta.fiscalYearEnd, pulledAt: m.pulledAt, nextReport: c.next ? c.next.date : null, nextReportWhen: c.next ? c.next.when : null, nextEpsEstimate: c.next ? c.next.estimate : null, year: null, years: dates.length };
  if (!dates.length) return row;
  const i = dates.length - 1, y = yearData(c, dates, i), start = Math.max(0, dates.length - 10);
  const gp = grossProfit(y), rev = v(y.inc, 'totalRevenue'), ni = v(y.inc, 'netIncome');
  const retained = v(y.bal, 'retainedEarnings'), retainedBefore = v(y.prevBal, 'retainedEarnings');
  const bought = v(y.cf, 'salePurchaseOfStock');
  Object.assign(row, {
    year: dates[i],
    revenue: rev,
    grossProfit: gp,
    netEarnings: ni,
    grossMargin: div(gp, rev),
    sgaOfGrossProfit: div(v(y.inc, 'sellingGeneralAdministrative'), gp),
    rdOfGrossProfit: div(v(y.inc, 'researchDevelopment'), gp),
    depreciationOfGrossProfit: div(v(y.inc, 'depreciationAndAmortization', 'reconciledDepreciation'), gp),
    interestOfOperatingIncome: div(v(y.inc, 'interestExpense'), v(y.inc, 'operatingIncome')),
    taxRate: div(v(y.inc, 'incomeTaxExpense', 'taxProvision'), v(y.inc, 'incomeBeforeTax')),
    netMargin: div(ni, rev),
    eps: epsOf(y),
    epsByYear: dates.slice(start).map((d, k) => [d, epsOf(yearData(c, dates, start + k))]),
    sharesOutstanding: y.shares,
    currentRatio: div(v(y.bal, 'totalCurrentAssets'), v(y.bal, 'totalCurrentLiabilities')),
    returnOnAssets: div(ni, v(y.bal, 'totalAssets')),
    longTermDebt: v(y.bal, 'longTermDebt', 'longTermDebtTotal'),
    yearsToClearDebt: div(v(y.bal, 'longTermDebt', 'longTermDebtTotal'), ni),
    debtToEquity: div(v(y.bal, 'totalLiab'), v(y.bal, 'totalStockholderEquity')),
    returnOnEquity: div(ni, v(y.bal, 'totalStockholderEquity')),
    retainedEarningsGrowth: (retained !== null && retainedBefore) ? (retained - retainedBefore) / Math.abs(retainedBefore) : null,
    treasuryStock: v(y.bal, 'treasuryStock'),
    capexOfNetEarnings: div(capex(y), ni),
    stockBoughtBack: bought === null ? null : -bought,
    dividendsPaid: (() => { const d = v(y.cf, 'dividendsPaid'); return d === null ? null : Math.abs(d); })()
  });
  return row;
}

// ---- the screen files --------------------------------------------------------

function writeScreens(manifest) {
  const byVenue = {};
  for (const symbol of Object.keys(manifest)) {
    const m = manifest[symbol];
    if (m.status !== 'ok') continue;
    const row = readJson(path.join(OUT, 'rows', symbol + '.json'));
    if (!row) continue;
    (byVenue[m.exchange] = byVenue[m.exchange] || []).push(row);
  }
  const index = { builtAt: new Date().toISOString(), venues: {} };
  for (const venue of Object.keys(byVenue).sort()) {
    const rows = byVenue[venue].sort((a, b) => a.symbol.localeCompare(b.symbol));
    writeJson(path.join(OUT, 'screen', venue + '.json'), rows);
    const newest = rows.reduce((t, r) => r.pulledAt > t ? r.pulledAt : t, '');
    index.venues[venue] = { file: venue + '.json', companies: rows.length, pulledUpTo: newest };
  }
  writeJson(path.join(OUT, 'screen', 'index.json'), index);
  const total = Object.values(index.venues).reduce((n, x) => n + x.companies, 0);
  console.log('Screen files: ' + Object.keys(index.venues).map(v => v + ' ' + index.venues[v].companies).join(', ') + ' (' + total + ' companies).');
}

// ---- small helpers -----------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[name] = next; i++; } else out[name] = true;
  }
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}
