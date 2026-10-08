// The pull engine shared by tools/pull-fundamentals.mjs (the command line) and
// tools/pull-app.mjs (the local page). It lists the common stocks of a set of
// EODHD exchanges, fetches each company's fundamentals and its split history,
// keeps the raw replies, the company in the shape the Numbers page keeps, one
// row of the book's ratios, and screen files per venue. Nothing here touches
// the site.
//
// The company shape, the next-report rule and the ratio formulas mirror
// extractCompany, nextReport and NUMBER_ROWS in public/index.html: change them together.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';

export const CALLS_FUNDAMENTALS = 10;
export const CALLS_SPLITS = 1;
export const CALLS_PER_COMPANY = CALLS_FUNDAMENTALS + CALLS_SPLITS;
export const DEFAULT_EXCHANGES = ['US', 'LSE', 'SHG', 'SHE', 'KO', 'KQ', 'XETRA'];
export const DEFAULT_US = ['NASDAQ', 'NYSE'];

// the markets a menu can offer: each is a set of EODHD lists, and for the US a venue filter
export const MARKETS = [
  { id: 'NASDAQ', name: 'NASDAQ', exchanges: ['US'], us: ['NASDAQ'] },
  { id: 'NYSE', name: 'New York Stock Exchange', exchanges: ['US'], us: ['NYSE'] },
  { id: 'LSE', name: 'London Stock Exchange', exchanges: ['LSE'], us: DEFAULT_US },
  { id: 'SHG', name: 'Shanghai Stock Exchange', exchanges: ['SHG'], us: DEFAULT_US },
  { id: 'SHE', name: 'Shenzhen Stock Exchange', exchanges: ['SHE'], us: DEFAULT_US },
  { id: 'KO', name: 'Korea Stock Exchange', exchanges: ['KO'], us: DEFAULT_US },
  { id: 'KQ', name: 'KOSDAQ', exchanges: ['KQ'], us: DEFAULT_US },
  { id: 'XETRA', name: 'Xetra, Germany', exchanges: ['XETRA'], us: DEFAULT_US },
  { id: 'ALL', name: 'All of the above', exchanges: DEFAULT_EXCHANGES, us: DEFAULT_US }
];

// ---- context -----------------------------------------------------------------

export function createContext(opts) {
  const ctx = {
    out: path.resolve(opts.out || 'data'),
    base: String(opts.base || 'https://eodhd.com/api/').replace(/\/?$/, '/'),
    token: opts.token || '',
    exchanges: opts.exchanges || DEFAULT_EXCHANGES,
    usKeep: new Set(opts.usKeep || DEFAULT_US),
    parallel: Math.max(1, opts.parallel || 4),
    limit: opts.limit || Infinity,
    refreshDays: opts.refreshDays === undefined || opts.refreshDays === null ? null : opts.refreshDays,
    only: opts.only || null,
    log: opts.log || function () {},
    onProgress: opts.onProgress || function () {},
    shouldStop: opts.shouldStop || function () { return false; },
    manifest: null
  };
  for (const d of ['raw', 'companies', 'rows', 'screen']) fs.mkdirSync(path.join(ctx.out, d), { recursive: true });
  ctx.manifest = readJson(path.join(ctx.out, 'pulled.json')) || {};
  return ctx;
}

export function saveManifest(ctx) {
  writeJson(path.join(ctx.out, 'pulled.json'), ctx.manifest);
}

// ---- the universe -----------------------------------------------------------

export async function loadUniverse(ctx) {
  if (ctx.only) {
    return ctx.only.map(symbol => {
      const m = ctx.manifest[symbol];
      const list = symbol.split('.').pop();
      return m ? { symbol, code: m.code, name: m.name, exchange: m.exchange, list: m.list, currency: m.currency }
        : { symbol, code: symbol.split('.')[0], name: symbol, exchange: list, list, currency: '' };
    });
  }
  const symbols = [];
  for (const list of ctx.exchanges) {
    const r = await eodhd(ctx, 'exchange-symbol-list/' + encodeURIComponent(list) + '?type=common_stock');
    if (r.status !== 200) throw new Error(describe(r.status, 'the symbol list for ' + list));
    const rows = JSON.parse(r.text);
    if (!Array.isArray(rows)) throw new Error('the symbol list for ' + list + ' is not a list');
    let kept = 0;
    for (const s of rows) {
      if (!s || !s.Code) continue;
      const venue = String(s.Exchange || list);
      if (list === 'US' && !ctx.usKeep.has(venue)) continue;
      symbols.push({ symbol: s.Code + '.' + list, code: String(s.Code), name: String(s.Name || s.Code), exchange: venue, list, currency: String(s.Currency || ''), country: String(s.Country || ''), isin: String(s.Isin || '') });
      kept++;
    }
    ctx.log(list + ': ' + rows.length + ' common stocks listed, ' + kept + ' kept');
  }
  writeJson(path.join(ctx.out, 'symbols.json'), { listedAt: new Date().toISOString(), exchanges: ctx.exchanges, us: Array.from(ctx.usKeep), symbols });
  return symbols;
}

// ---- the pull --------------------------------------------------------------

export async function pull(ctx, universe) {
  const now = Date.now();
  const manifest = ctx.manifest;
  const due = universe.filter(s => {
    const m = manifest[s.symbol];
    if (!m) return true;
    if (m.status === 'error') return true;
    if (ctx.refreshDays !== null && m.pulledAt && (now - Date.parse(m.pulledAt)) / 86400000 > ctx.refreshDays) return true;
    return false;
  }).slice(0, ctx.limit);
  const summary = { universe: universe.length, due: due.length, done: 0, ok: 0, missing: 0, refused: 0, error: 0, splitsMissing: 0, calls: 0, stop: '', remaining: 0 };
  ctx.log(universe.length + ' companies in the universe, ' + due.length + ' to pull' + (Number.isFinite(ctx.limit) ? ' this run' : '') + '.');
  if (!due.length) return summary;

  let next = 0, refusedInARow = 0;
  const save = () => saveManifest(ctx);
  const onExit = () => { save(); process.exit(130); };
  process.on('SIGINT', onExit);

  async function worker() {
    while (!summary.stop && next < due.length && !ctx.shouldStop()) {
      const s = due[next++];
      let r = null, failure = '';
      try {
        r = await eodhd(ctx, 'fundamentals/' + encodeURIComponent(s.symbol));
      } catch (e) {
        failure = e && e.message ? e.message : String(e);
      }
      summary.calls += CALLS_FUNDAMENTALS;
      if (failure) {
        manifest[s.symbol] = entry(s, 'error', failure);
        summary.error++;
      } else if (r.status === 200) {
        let data;
        try { data = JSON.parse(r.text); } catch (e) { data = null; }
        if (!data || typeof data !== 'object') {
          manifest[s.symbol] = entry(s, 'error', 'EODHD sent back something that is not JSON');
          summary.error++;
        } else {
          fs.writeFileSync(path.join(ctx.out, 'raw', s.symbol + '.json.gz'), zlib.gzipSync(r.text));
          // the split history, one more call; a failure here keeps the company and is noted for a splits run
          const sp = await fetchSplits(ctx, s.symbol, summary);
          const c = extractCompany(s.symbol, data, undefined, sp.rows || null);
          writeJson(path.join(ctx.out, 'companies', s.symbol + '.json'), c);
          manifest[s.symbol] = entry(s, 'ok', '', r.text.length, c);
          if (sp.rows) manifest[s.symbol].splits = true;
          else { manifest[s.symbol].splitsNote = sp.stop || sp.error; summary.splitsMissing++; }
          writeJson(path.join(ctx.out, 'rows', s.symbol + '.json'), screenRow(manifest[s.symbol], c));
          summary.ok++;
          refusedInARow = 0;
          if (sp.stop) summary.stop = sp.stop;
        }
      } else if (r.status === 404) {
        manifest[s.symbol] = entry(s, 'missing', 'EODHD has no fundamentals under this symbol');
        summary.missing++;
        refusedInARow = 0;
      } else if (r.status === 403) {
        manifest[s.symbol] = entry(s, 'refused', 'the plan does not cover this symbol');
        summary.refused++;
        if (++refusedInARow >= 5) summary.stop = describe(403, 'five companies in a row');
      } else if (r.status === 401 || r.status === 402) {
        summary.stop = describe(r.status, s.symbol);
        continue; // not pulled and not counted: it waits for the next run
      } else {
        manifest[s.symbol] = entry(s, 'error', 'EODHD answered ' + r.status);
        summary.error++;
      }
      summary.done++;
      if (summary.done % 25 === 0) save();
      ctx.onProgress(Object.assign({ current: s.symbol, total: due.length }, summary));
    }
  }
  await Promise.all(Array.from({ length: ctx.parallel }, worker));
  process.off('SIGINT', onExit);
  save();

  summary.remaining = due.length - summary.done;
  if (!summary.stop && ctx.shouldStop() && summary.remaining) summary.stop = 'stopped by you';
  ctx.log('Pulled ' + summary.ok + ', missing ' + summary.missing + ', refused ' + summary.refused + ', errors ' + summary.error + '; about ' + summary.calls + ' EODHD calls spent this run.' +
    (summary.splitsMissing ? ' The splits of ' + summary.splitsMissing + ' could not be fetched: a splits run asks for them again.' : ''));
  if (summary.stop) ctx.log('Stopped early: ' + summary.stop + (summary.remaining ? ' ' + summary.remaining + ' companies are left for the next run.' : ''));
  else if (summary.remaining) ctx.log(summary.remaining + ' companies are left for the next run.');
  return summary;
}

// one company's split history: EODHD's splits/<symbol>, one call, the reply kept
// gzipped beside the fundamentals. Answers { rows }, { error } or { stop } when
// the token is refused or the day's calls are spent.
async function fetchSplits(ctx, symbol, summary) {
  let r;
  try {
    r = await eodhd(ctx, 'splits/' + encodeURIComponent(symbol));
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
  summary.calls += CALLS_SPLITS;
  if (r.status === 200) {
    let rows;
    try { rows = JSON.parse(r.text); } catch (e) { rows = null; }
    if (!Array.isArray(rows)) return { error: 'EODHD sent back something that is not a list of splits' };
    fs.writeFileSync(path.join(ctx.out, 'raw', symbol + '.splits.json.gz'), zlib.gzipSync(r.text));
    return { rows };
  }
  if (r.status === 401 || r.status === 402) return { stop: describe(r.status, symbol + ' (splits)') };
  return { error: 'EODHD answered ' + r.status + ' for the splits' };
}

// the companies on disk whose split history is not: pulled before the splits
// were fetched, or whose splits call failed
export function splitsDue(ctx) {
  return Object.keys(ctx.manifest).filter(s => ctx.manifest[s] && ctx.manifest[s].status === 'ok' && !ctx.manifest[s].splits);
}

// a splits run: the split history of every company on disk without one, one call
// each, the company's file given its splits; stops on 402 like a pull and resumes
export async function pullSplits(ctx) {
  const due = splitsDue(ctx).slice(0, ctx.limit);
  const summary = { due: due.length, done: 0, ok: 0, error: 0, calls: 0, stop: '', remaining: 0 };
  ctx.log(due.length + ' companies on disk without their splits.');
  if (!due.length) return summary;
  let next = 0;
  const save = () => saveManifest(ctx);
  const onExit = () => { save(); process.exit(130); };
  process.on('SIGINT', onExit);
  async function worker() {
    while (!summary.stop && next < due.length && !ctx.shouldStop()) {
      const symbol = due[next++];
      const sp = await fetchSplits(ctx, symbol, summary);
      if (sp.stop) { summary.stop = sp.stop; continue; } // not counted: it waits for the next run
      const m = ctx.manifest[symbol];
      if (sp.rows) {
        const file = path.join(ctx.out, 'companies', symbol + '.json');
        const c = readJson(file);
        if (c) { c.splits = readSplits(sp.rows); writeJson(file, c); }
        m.splits = true;
        delete m.splitsNote;
        summary.ok++;
      } else {
        m.splitsNote = sp.error;
        summary.error++;
      }
      summary.done++;
      if (summary.done % 25 === 0) save();
      ctx.onProgress(Object.assign({ current: symbol, total: due.length }, summary));
    }
  }
  await Promise.all(Array.from({ length: ctx.parallel }, worker));
  process.off('SIGINT', onExit);
  save();
  summary.remaining = due.length - summary.done;
  if (!summary.stop && ctx.shouldStop() && summary.remaining) summary.stop = 'stopped by you';
  ctx.log('Splits fetched for ' + summary.ok + ', errors ' + summary.error + '; ' + summary.calls + ' EODHD calls spent this run.');
  if (summary.stop) ctx.log('Stopped early: ' + summary.stop + (summary.remaining ? ' ' + summary.remaining + ' companies are left for the next run.' : ''));
  else if (summary.remaining) ctx.log(summary.remaining + ' companies are left for the next run.');
  return summary;
}

function entry(s, status, note, bytes, c) {
  const e = { code: s.code, name: s.name, exchange: s.exchange, list: s.list, currency: s.currency, pulledAt: new Date().toISOString(), status, note: note || '' };
  if (bytes) e.bytes = bytes;
  if (c && c.meta) { e.name = c.meta.name || e.name; e.currency = c.meta.currency || e.currency; }
  return e;
}

export function describe(status, what) {
  if (status === 401) return 'EODHD does not recognise the token (401) on ' + what + '.';
  if (status === 402) return 'the day’s EODHD calls are spent (402) at ' + what + '; run again when the allowance resets.';
  if (status === 403) return 'EODHD refused ' + what + ' (403): the plan does not cover it.';
  if (status === 404) return 'EODHD has nothing at ' + what + ' (404).';
  return 'EODHD answered ' + status + ' on ' + what + '.';
}

// one request to EODHD, retried on the rate limit, server errors and network failures
export async function eodhd(ctx, pathAndQuery) {
  const url = new URL(pathAndQuery, ctx.base);
  url.searchParams.set('api_token', ctx.token);
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

// the account's usage from EODHD's user endpoint: calls used today against the daily limit
export async function usage(ctx) {
  const r = await eodhd(ctx, 'user');
  if (r.status !== 200) throw new Error(describe(r.status, 'your account'));
  let d;
  try { d = JSON.parse(r.text); } catch (e) { throw new Error('EODHD sent back something that is not JSON for your account'); }
  return {
    used: num(d.apiRequests),
    limit: num(d.dailyRateLimit),
    extra: num(d.extraLimit),
    date: String(d.apiRequestsDate || ''),
    plan: String(d.subscriptionType || d.subscriptionMode || '')
  };
}

// ---- the company shape, as the Numbers page keeps it -------------------------

const MAX_QUARTERS = 40;

export function num(v) {
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
// EODHD's split history as the page keeps it: each entry a date and a ratio, new
// shares over old ("4.000000/1.000000" is four new for one old), as it came with
// the ratio as a number, oldest first. Mirrors readSplits in public/index.html.
export function readSplits(src) {
  const out = [];
  if (!Array.isArray(src)) return out;
  for (const r of src) {
    if (!r || typeof r !== 'object') continue;
    const date = String(r.date || ''), split = String(r.split || '');
    const m = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(split);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !m) continue;
    const ratio = parseFloat(m[1]) / parseFloat(m[2]);
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    out.push({ date, split, ratio });
  }
  out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return out;
}

export function nextReport(src) {
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

// A short form of the business description for a screen row: whole sentences, about 320 characters.
export function shortAbout(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= 320) return s;
  const cut = s.slice(0, 320);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '\u2026').trim();
}

export function extractCompany(symbol, data, fetchedAt, splits) {
  const fin = data.Financials || {};
  const g = data.General && typeof data.General === 'object' ? data.General : {};
  const c = {
    symbol,
    fetchedAt: fetchedAt || new Date().toISOString(),
    meta: {
      code: String(g.Code || symbol),
      name: String(g.Name || symbol),
      exchange: String(g.Exchange || ''),
      currency: String(g.CurrencyCode || (fin.Income_Statement && fin.Income_Statement.currency_symbol) || ''),
      fiscalYearEnd: String(g.FiscalYearEnd || ''),
      sector: String(g.Sector || ''),
      industry: String(g.Industry || ''),
      // what the company does, and the facts beside it, from the same General block
      description: String(g.Description || '').trim(),
      web: String(g.WebURL || '').trim(),
      employees: num(g.FullTimeEmployees),
      ipo: String(g.IPODate || '').trim(),
      country: String(g.CountryName || '').trim(),
      address: String(g.Address || '').trim()
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
  if (Array.isArray(splits)) c.splits = readSplits(splits);
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

export function screenRow(m, c) {
  const dates = yearList(c);
  const row = { symbol: c.symbol, name: m.name, exchange: m.exchange, currency: c.meta.currency, sector: c.meta.sector, industry: c.meta.industry, fiscalYearEnd: c.meta.fiscalYearEnd, pulledAt: m.pulledAt, nextReport: c.next ? c.next.date : null, nextReportWhen: c.next ? c.next.when : null, nextEpsEstimate: c.next ? c.next.estimate : null,
    about: shortAbout(c.meta.description), web: c.meta.web || '', employees: num(c.meta.employees), ipo: c.meta.ipo || '', country: c.meta.country || '', year: null, years: dates.length };
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

// Rebuild every company's file and row from the raw reply kept on disk: no
// calls, the same shapes, with whatever fields the extraction has gained since.
export function reextract(ctx) {
  let rebuilt = 0, missing = 0, noSplits = 0;
  for (const symbol of Object.keys(ctx.manifest)) {
    const m = ctx.manifest[symbol];
    if (!m || m.status !== 'ok') continue;
    const file = path.join(ctx.out, 'raw', symbol + '.json.gz');
    let data = null;
    try { data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); } catch (e) { data = null; }
    if (!data || typeof data !== 'object') { missing++; continue; }
    // the saved split list too, when the pull fetched one
    let splits = null;
    try { splits = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ctx.out, 'raw', symbol + '.splits.json.gz'))).toString('utf8')); } catch (e) { splits = null; }
    if (!Array.isArray(splits)) { splits = null; noSplits++; }
    const c = extractCompany(symbol, data, m.pulledAt, splits);
    writeJson(path.join(ctx.out, 'companies', symbol + '.json'), c);
    writeJson(path.join(ctx.out, 'rows', symbol + '.json'), screenRow(m, c));
    if (splits) { m.splits = true; delete m.splitsNote; }
    rebuilt++;
  }
  saveManifest(ctx);
  ctx.log('Rebuilt ' + rebuilt + ' companies from the saved replies' + (missing ? '; ' + missing + ' had no saved reply' : '') + (noSplits ? '; ' + noSplits + ' have no saved split list, which a splits run fetches' : '') + '.');
  return { rebuilt, missing, noSplits };
}

export function recomputeRows(ctx) {
  let n = 0;
  for (const symbol of Object.keys(ctx.manifest)) {
    const c = readJson(path.join(ctx.out, 'companies', symbol + '.json'));
    if (!c) continue;
    writeJson(path.join(ctx.out, 'rows', symbol + '.json'), screenRow(ctx.manifest[symbol], c));
    n++;
  }
  ctx.log('Recomputed ' + n + ' rows.');
  return n;
}

// ---- the screen files: JSON for the site, CSV for a spreadsheet -----------------

function csvCell(s) {
  s = s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : String(s));
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function writeScreens(ctx) {
  const byVenue = {};
  for (const symbol of Object.keys(ctx.manifest)) {
    const m = ctx.manifest[symbol];
    if (m.status !== 'ok') continue;
    const row = readJson(path.join(ctx.out, 'rows', symbol + '.json'));
    if (!row) continue;
    (byVenue[m.exchange] = byVenue[m.exchange] || []).push(row);
  }
  const index = { builtAt: new Date().toISOString(), venues: {} };
  for (const venue of Object.keys(byVenue).sort()) {
    const rows = byVenue[venue].sort((a, b) => a.symbol.localeCompare(b.symbol));
    writeJson(path.join(ctx.out, 'screen', venue + '.json'), rows);
    const columns = Object.keys(rows[0]);
    const csv = [columns.join(',')].concat(rows.map(r => columns.map(k => csvCell(r[k])).join(','))).join('\r\n') + '\r\n';
    fs.writeFileSync(path.join(ctx.out, 'screen', venue + '.csv'), csv);
    const newest = rows.reduce((t, r) => r.pulledAt > t ? r.pulledAt : t, '');
    index.venues[venue] = { file: venue + '.json', csv: venue + '.csv', companies: rows.length, pulledUpTo: newest };
  }
  writeJson(path.join(ctx.out, 'screen', 'index.json'), index);
  const total = Object.values(index.venues).reduce((n, x) => n + x.companies, 0);
  ctx.log('Screen files: ' + Object.keys(index.venues).map(v => v + ' ' + index.venues[v].companies).join(', ') + ' (' + total + ' companies).');
  return index;
}

// ---- the sample watchlists, read from the page so there is one copy ---------------

export function loadSampleWatchlists(repoRoot) {
  const page = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const start = page.indexOf('var STARTING_LISTS = [');
  if (start < 0) throw new Error('the sample watchlists were not found in public/index.html');
  const open = page.indexOf('[', start);
  let depth = 0, end = -1;
  for (let i = open; i < page.length; i++) {
    const ch = page[i];
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error('the sample watchlists in public/index.html do not close');
  const lists = new Function('return ' + page.slice(open, end))();
  return lists.map(l => ({ name: l[0], items: l[1].map(it => ({ name: it[0], symbol: it[1] })) }));
}

// ---- small helpers -----------------------------------------------------------

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

export function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

export function parseArgs(argv) {
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
