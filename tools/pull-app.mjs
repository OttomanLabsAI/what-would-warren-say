#!/usr/bin/env node
// A page on your own machine for pulling EODHD fundamentals: pick a market or
// one of the sample watchlists, paste your token, press Start, and watch the
// calls being spent. Needs Node 18 or later and nothing else.
//
//   npm run pull-app                 then open the address it prints (a Mac opens it for you)
//   node tools/pull-app.mjs [--port 8787] [--out data] [--base <url>] [--no-open]
//
// Files land under --out exactly as the command line puller writes them (see
// tools/pull-fundamentals.mjs): JSON in the shape the site keeps, and a CSV per
// venue for a spreadsheet. The token stays on this machine: in memory, or in
// data/eodhd-token.txt when you tick "remember"; never in the repository or the site.
// A second form sends the pull to the site's store, an R2 bucket, with the keys
// of an R2 API token (in memory, or in data/r2.json when remembered): see
// tools/lib/store.mjs. The page is served on 127.0.0.1 only.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createContext, loadUniverse, pull, writeScreens, usage, MARKETS, loadSampleWatchlists, parseArgs, CALLS_PER_COMPANY } from './lib/pull.mjs';
import { uploadStore, DEFAULT_BUCKET } from './lib/store.mjs';

const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(args.out || 'data');
const BASE = args.base || 'https://eodhd.com/api/';
const PORT = args.port === undefined ? 8787 : parseInt(args.port, 10);
const TOKEN_FILE = path.join(OUT, 'eodhd-token.txt');
const R2_FILE = path.join(OUT, 'r2.json');

const state = { running: false, stopRequested: false, what: '', startedAt: '', finishedAt: '', progress: null, summary: null, lists: 0, error: '', usageBefore: null, usageAfter: null, files: [], log: [],
  send: { running: false, stopRequested: false, startedAt: '', finishedAt: '', progress: null, summary: null, error: '' } };
let watchlists = [], watchlistError = '';
try { watchlists = loadSampleWatchlists(ROOT); } catch (e) { watchlistError = e.message; }

fs.mkdirSync(OUT, { recursive: true });
let token = rememberedToken();
let r2 = rememberedR2();

function rememberedToken() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch (e) { return ''; }
}

function rememberedR2() {
  try { const r = JSON.parse(fs.readFileSync(R2_FILE, 'utf8')); return { endpoint: r.endpoint || '', bucket: r.bucket || DEFAULT_BUCKET, accessKeyId: r.accessKeyId || '', secretAccessKey: r.secretAccessKey || '' }; }
  catch (e) { return { endpoint: '', bucket: DEFAULT_BUCKET, accessKeyId: '', secretAccessKey: '' }; }
}

function log(line) {
  state.log.push(new Date().toTimeString().slice(0, 8) + '  ' + line);
  if (state.log.length > 400) state.log.shift();
}

async function run(job) {
  Object.assign(state, { running: true, stopRequested: false, startedAt: new Date().toISOString(), finishedAt: '', progress: null, summary: null, lists: 0, error: '', usageBefore: null, usageAfter: null, files: [] });
  try {
    const opts = { out: OUT, base: BASE, token, parallel: 4, limit: job.limit || Infinity, refreshDays: job.refresh ? 0 : null, log, onProgress: p => { state.progress = p; }, shouldStop: () => state.stopRequested };
    if (job.watchlist) {
      const list = watchlists.find(w => w.name === job.watchlist);
      if (!list) throw new Error('no sample watchlist called ' + job.watchlist);
      opts.only = list.items.map(it => it.symbol);
      state.what = 'the watchlist ' + list.name;
    } else {
      const market = MARKETS.find(m => m.id === job.market);
      if (!market) throw new Error('no market called ' + job.market);
      opts.exchanges = market.exchanges;
      opts.usKeep = market.us;
      state.what = market.name;
      state.lists = market.exchanges.length;
    }
    log('Starting on ' + state.what + '.');
    const ctx = createContext(opts);
    try { state.usageBefore = await usage(ctx); } catch (e) { log('Could not read your usage from EODHD: ' + e.message); }
    const universe = await loadUniverse(ctx);
    state.summary = await pull(ctx, universe);
    const index = writeScreens(ctx);
    state.files = (opts.only ? [] : ['symbols.json']).concat(['pulled.json'], Object.keys(index.venues).map(v => 'screen/' + v + '.json'), Object.keys(index.venues).map(v => 'screen/' + v + '.csv'), ['screen/index.json', 'companies/ (one file per company)', 'raw/ (one gzipped reply per company)']);
    try { state.usageAfter = await usage(ctx); } catch (e) { log('Could not read your usage from EODHD: ' + e.message); }
  } catch (e) {
    state.error = e && e.message ? e.message : String(e);
    log('Stopped: ' + state.error);
  }
  state.running = false;
  state.finishedAt = new Date().toISOString();
}

async function send(job) {
  const st = state.send;
  Object.assign(st, { running: true, stopRequested: false, startedAt: new Date().toISOString(), finishedAt: '', progress: null, summary: null, error: '' });
  try {
    log('Sending the pull to the store ' + r2.bucket + '.');
    st.summary = await uploadStore({ out: OUT, endpoint: r2.endpoint, bucket: r2.bucket, accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey, all: job.all, parallel: 8, log, onProgress: p => { st.progress = Object.assign({}, p); }, shouldStop: () => st.stopRequested });
  } catch (e) {
    st.error = e && e.message ? e.message : String(e);
    if (e && e.summary) st.summary = e.summary;
    log('Send stopped: ' + st.error);
  }
  st.running = false;
  st.finishedAt = new Date().toISOString();
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) reject(new Error('too long')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(PAGE);
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, Object.assign({}, state, {
      markets: MARKETS.map(m => ({ id: m.id, name: m.name })),
      watchlists: watchlists.map(w => ({ name: w.name, count: w.items.length })),
      watchlistError, out: OUT, hasToken: !!token, remembered: fs.existsSync(TOKEN_FILE), callsPerCompany: CALLS_PER_COMPANY,
      r2: { endpoint: r2.endpoint, bucket: r2.bucket, hasKeys: !!(r2.accessKeyId && r2.secretAccessKey), remembered: fs.existsSync(R2_FILE) }
    }));
  }
  if (req.method === 'POST' && url.pathname === '/api/start') {
    if (state.running) return sendJson(res, 409, { error: 'A pull is already running.' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'Bad request.' }); }
    const typed = String(body.token || '').trim();
    if (typed) token = typed;
    if (!token) return sendJson(res, 400, { error: 'Paste your EODHD API token.' });
    try {
      if (body.remember) fs.writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600 });
      else if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
    } catch (e) {
      log('Could not update the remembered token: ' + e.message);
    }
    const job = { market: String(body.market || 'NASDAQ'), watchlist: String(body.watchlist || ''), refresh: !!body.refresh, limit: body.limit ? Math.max(1, parseInt(body.limit, 10) || 0) : 0 };
    run(job);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/send') {
    if (state.send.running) return sendJson(res, 409, { error: 'A send is already running.' });
    if (state.running) return sendJson(res, 409, { error: 'Wait for the pull to finish before sending.' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'Bad request.' }); }
    const typed = k => String(body[k] || '').trim();
    r2 = { endpoint: typed('endpoint') || r2.endpoint, bucket: typed('bucket') || r2.bucket || DEFAULT_BUCKET, accessKeyId: typed('accessKeyId') || r2.accessKeyId, secretAccessKey: typed('secretAccessKey') || r2.secretAccessKey };
    if (!r2.endpoint) return sendJson(res, 400, { error: 'Paste the S3 endpoint of your R2 account.' });
    if (!r2.accessKeyId || !r2.secretAccessKey) return sendJson(res, 400, { error: 'Paste the Access Key ID and the Secret Access Key of an R2 API token.' });
    try {
      if (body.remember) fs.writeFileSync(R2_FILE, JSON.stringify(r2, null, 2) + '\n', { mode: 0o600 });
      else if (fs.existsSync(R2_FILE)) fs.unlinkSync(R2_FILE);
    } catch (e) {
      log('Could not update the remembered keys: ' + e.message);
    }
    send({ all: !!body.all });
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/send-stop') {
    state.send.stopRequested = true;
    if (state.send.running) log('Stopping the send after the files in flight.');
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/stop') {
    state.stopRequested = true;
    if (state.running) log('Stopping after the fetches in flight.');
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const address = 'http://127.0.0.1:' + server.address().port + '/';
  console.log('Open ' + address);
  console.log('Files go to ' + OUT);
  if (!args['no-open']) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(cmd + ' ' + address, () => {});
  }
});

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pull from EODHD</title>
<style>
  :root { --paper: #FFF1E5; --paper-deep: #F2DFCE; --white: #FFFCFA; --ink: #33302E; --ink-60: #66605C; --ink-40: #999189; --rule: #CCC1B7; --rule-light: #E6D9CE; --claret: #990F3D; --teal: #0D7680; }
  html { background: var(--paper); }
  body { margin: 0; color: var(--ink); font-family: Georgia, 'Times New Roman', serif; font-size: 1.05rem; line-height: 1.5; }
  .wrap { max-width: 56rem; margin: 0 auto; padding: 0 1rem 3rem; }
  h1 { margin: 1.2rem 0 .2rem; font-size: 2rem; line-height: 1.1; }
  h2 { margin: 2.2rem 0 .2rem; font-size: 1.4rem; line-height: 1.1; }
  .tag { margin: 0 0 1.2rem; font-style: italic; color: var(--ink-60); border-bottom: 3px double var(--ink); padding-bottom: .8rem; }
  form { display: grid; grid-template-columns: 1fr 1fr; gap: .9rem 1.4rem; align-items: end; }
  .f { display: flex; flex-direction: column; gap: .3rem; min-width: 0; }
  .f.wide { grid-column: 1 / -1; }
  label.t, legend { font-family: system-ui, sans-serif; font-size: .72rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-60); }
  input[type=text], input[type=password], input[type=number], select { font-family: system-ui, sans-serif; font-size: 1rem; padding: .5rem .65rem; border: 1px solid var(--ink); border-radius: 0; background: var(--white); color: var(--ink); width: 100%; box-sizing: border-box; }
  select:disabled { color: var(--ink-40); border-color: var(--rule); background: var(--paper-deep); }
  .check { display: flex; align-items: center; gap: .5rem; font-family: system-ui, sans-serif; font-size: .9rem; }
  .check input { accent-color: var(--claret); margin: 0; }
  .buttons { grid-column: 1 / -1; display: flex; gap: .7rem; align-items: center; }
  button { font-family: system-ui, sans-serif; font-size: .85rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: .55rem 1rem; border: 1px solid var(--ink); border-radius: 0; background: var(--ink); color: var(--paper); cursor: pointer; }
  button.secondary { background: transparent; color: var(--ink); }
  button:disabled { opacity: .45; cursor: default; }
  .hint { font-family: system-ui, sans-serif; font-size: .82rem; color: var(--ink-60); margin: .2rem 0 0; }
  .status { margin: 1.4rem 0 0; padding: .9rem 1rem; border: 1px solid var(--rule); background: var(--white); font-family: system-ui, sans-serif; font-size: .92rem; }
  .status b.k { display: block; font-size: .72rem; letter-spacing: .14em; text-transform: uppercase; color: var(--claret); margin-bottom: .3rem; }
  .bar { height: 10px; background: var(--paper-deep); margin: .6rem 0; }
  .bar div { height: 100%; background: var(--ink); width: 0; transition: width .3s; }
  .err { color: var(--claret); font-weight: 700; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; margin: .4rem 0 0; font-family: system-ui, sans-serif; font-size: .9rem; }
  dt { color: var(--ink-60); } dd { margin: 0; font-variant-numeric: tabular-nums; }
  pre { margin: .6rem 0 0; padding: .7rem .9rem; background: var(--paper-deep); font-size: .78rem; line-height: 1.45; white-space: pre-wrap; max-height: 16rem; overflow: auto; }
  ul.files { margin: .3rem 0 0; padding-left: 1.2rem; font-family: system-ui, sans-serif; font-size: .88rem; }
  @media (max-width: 40rem) { form { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <h1>Pull from EODHD</h1>
  <p class="tag">What Would Warren Say? &middot; every company of a market, or a sample watchlist, saved on this machine</p>
  <form id="form" autocomplete="off">
    <div class="f wide"><label class="t" for="token">EODHD API token</label><input type="password" id="token" placeholder="paste your token"><p class="hint" id="token-hint"></p></div>
    <div class="f wide"><label class="check"><input type="checkbox" id="remember"> Remember the token on this machine (it goes in the data folder, never in the repository)</label></div>
    <div class="f"><label class="t" for="market">Market</label><select id="market"></select></div>
    <div class="f"><label class="t" for="watchlist">Or a sample watchlist</label><select id="watchlist"></select><p class="hint" id="watchlist-hint"></p></div>
    <div class="f"><label class="check"><input type="checkbox" id="refresh"> Pull again companies already on disk</label></div>
    <div class="f"><label class="t" for="limit">At most this many companies this run</label><input type="number" id="limit" min="1" placeholder="all of them"></div>
    <div class="buttons"><button type="submit" id="start">Start</button><button type="button" class="secondary" id="stop" disabled>Stop</button><span class="hint" id="cost"></span></div>
  </form>
  <div class="status" id="status"></div>
  <div class="status" id="usage"></div>
  <div class="status" id="files"></div>
  <h2>Send to the site</h2>
  <p class="tag">The companies with statements, the screen rows and an index go into the site's store, an R2 bucket in your Cloudflare account; the raw replies stay here</p>
  <form id="send-form" autocomplete="off">
    <div class="f wide"><label class="t" for="endpoint">S3 endpoint</label><input type="text" id="endpoint" placeholder="https://<account id>.r2.cloudflarestorage.com" spellcheck="false"><p class="hint">In the Cloudflare dashboard open R2, then Manage R2 API Tokens, and create a token with Object Read &amp; Write on the bucket. It shows the endpoint, the Access Key ID and the Secret Access Key.</p></div>
    <div class="f"><label class="t" for="access-key">Access Key ID</label><input type="text" id="access-key" spellcheck="false"></div>
    <div class="f"><label class="t" for="secret-key">Secret Access Key</label><input type="password" id="secret-key"></div>
    <div class="f"><label class="t" for="bucket">Bucket</label><input type="text" id="bucket" spellcheck="false"></div>
    <div class="f"><label class="check"><input type="checkbox" id="remember-keys"> Remember the keys on this machine (in the data folder, never in the repository)</label><label class="check"><input type="checkbox" id="send-all"> Send everything again, not only what changed</label></div>
    <div class="buttons"><button type="submit" id="send">Send to the site</button><button type="button" class="secondary" id="send-stop" disabled>Stop</button><span class="hint" id="keys-hint"></span></div>
  </form>
  <div class="status" id="send-status"></div>
  <div class="status"><b class="k">Log</b><pre id="log"></pre></div>
</div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var filled = false, lastError = '', lastSendError = '';
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(n) { return n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'); }
  function fill(s) {
    $('market').innerHTML = s.markets.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('');
    $('watchlist').innerHTML = '<option value="">No watchlist: the whole market</option>' + s.watchlists.map(function (w) { return '<option value="' + esc(w.name) + '">' + esc(w.name) + ' (' + w.count + ')</option>'; }).join('');
    $('watchlist-hint').textContent = s.watchlistError ? 'The sample watchlists could not be read: ' + s.watchlistError : 'The lists from the Watchlists page, as they came in the sample screenshots.';
    $('cost').textContent = 'Ten EODHD calls a company, one a market list.';
    $('endpoint').value = s.r2.endpoint || ''; $('bucket').value = s.r2.bucket || '';
    filled = true;
  }
  function render(s) {
    if (!filled) fill(s);
    $('token-hint').textContent = s.remembered ? 'A token is remembered on this machine: leave the box empty to use it, or paste another.' : (s.hasToken ? 'Using the token pasted earlier this session.' : 'The token is used from this machine only and never leaves it except to reach EODHD.');
    $('market').disabled = !!$('watchlist').value;
    $('start').disabled = s.running; $('stop').disabled = !s.running;
    var html = '<b class="k">' + (s.running ? 'Running' : (s.finishedAt ? 'Finished' : 'Ready')) + '</b>';
    if (s.running || s.finishedAt) html += '<div>' + esc(s.what) + (s.startedAt ? ', started ' + new Date(s.startedAt).toLocaleTimeString() : '') + (s.finishedAt ? ', finished ' + new Date(s.finishedAt).toLocaleTimeString() : '') + '</div>';
    var p = s.progress;
    if (p) {
      html += '<div class="bar"><div style="width:' + (p.total ? Math.round(100 * p.done / p.total) : 0) + '%"></div></div>';
      if (s.running || !s.summary) html += '<dl><dt>Pulled</dt><dd>' + fmt(p.done) + ' of ' + fmt(p.total) + (p.current ? ', last ' + esc(p.current) : '') + '</dd>' +
        '<dt>Of which</dt><dd>' + fmt(p.ok) + ' with figures, ' + fmt(p.missing) + ' with none at EODHD, ' + fmt(p.refused) + ' refused by the plan, ' + fmt(p.error) + ' errors</dd>' +
        '<dt>Calls spent this run</dt><dd>about ' + fmt(p.calls + s.lists) + '</dd></dl>';
    } else if (s.running) html += '<div>Listing the companies…</div>';
    if (s.summary && !s.running) {
      var m = s.summary;
      html += '<dl><dt>Companies</dt><dd>' + fmt(m.universe) + ' in the universe, ' + fmt(m.due) + ' to pull</dd>' +
        '<dt>Pulled</dt><dd>' + fmt(m.ok) + ' with figures, ' + fmt(m.missing) + ' with none at EODHD, ' + fmt(m.refused) + ' refused by the plan, ' + fmt(m.error) + ' errors</dd>' +
        '<dt>Calls spent this run</dt><dd>about ' + fmt(m.calls + s.lists) + '</dd>' +
        (m.stop ? '<dt>Stopped early</dt><dd class="err">' + esc(m.stop) + (m.remaining ? ' ' + fmt(m.remaining) + ' companies are left for the next run.' : '') + '</dd>' : (m.remaining ? '<dt>Left</dt><dd>' + fmt(m.remaining) + ' companies for the next run</dd>' : '')) + '</dl>';
    }
    if (s.error) html += '<div class="err">' + esc(s.error) + '</div>';
    if (lastError) html += '<div class="err">' + esc(lastError) + '</div>';
    $('status').innerHTML = html;
    var u = '<b class="k">EODHD’s own count</b>';
    if (s.usageBefore) u += '<dl><dt>Before this run</dt><dd>' + fmt(s.usageBefore.used) + ' of ' + fmt(s.usageBefore.limit) + ' calls used today' + (s.usageBefore.plan ? ' (' + esc(s.usageBefore.plan) + ')' : '') + '</dd>' +
      (s.usageAfter ? '<dt>After</dt><dd>' + fmt(s.usageAfter.used) + ' of ' + fmt(s.usageAfter.limit) + ', so EODHD counted ' + fmt(s.usageAfter.used - s.usageBefore.used) + ' calls for this run</dd>' : '') + '</dl>';
    else u += '<div class="hint">Shown once a run starts: EODHD reports the calls used today against the daily limit.</div>';
    $('usage').innerHTML = u;
    $('files').innerHTML = '<b class="k">Files</b><div>In ' + esc(s.out) + '</div>' + (s.files.length ? '<ul class="files">' + s.files.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' : '<div class="hint">Nothing written yet this session.</div>');
    var sd = s.send;
    $('send').disabled = sd.running || s.running; $('send-stop').disabled = !sd.running;
    $('keys-hint').textContent = sd.running ? '' : (s.r2.remembered ? 'Keys are remembered on this machine: leave the boxes empty to use them.' : (s.r2.hasKeys ? 'Using the keys pasted earlier this session.' : 'The keys stay on this machine and go only to Cloudflare.'));
    var t = '<b class="k">' + (sd.running ? 'Sending' : (sd.finishedAt ? 'Finished' : 'Ready')) + '</b>';
    if (sd.startedAt) t += '<div>Started ' + new Date(sd.startedAt).toLocaleTimeString() + (sd.finishedAt ? ', finished ' + new Date(sd.finishedAt).toLocaleTimeString() : '') + '</div>';
    var sp = sd.progress;
    if (sp && (sd.running || !sd.summary)) {
      t += '<div class="bar"><div style="width:' + (sp.total ? Math.round(100 * sp.done / sp.total) : 0) + '%"></div></div>' +
        '<dl><dt>Sent</dt><dd>' + fmt(sp.done) + ' of ' + fmt(sp.total) + ' files, ' + fmt(Math.round(sp.bytes / 1e5) / 10) + ' MB' + (sp.current ? ', now ' + esc(sp.current) : '') + '</dd>' +
        (sp.skipped ? '<dt>Unchanged</dt><dd>' + fmt(sp.skipped) + ' already in the store from this pull</dd>' : '') + (sp.failed ? '<dt>Failed</dt><dd class="err">' + fmt(sp.failed) + '</dd>' : '') + '</dl>';
    }
    if (sd.summary && !sd.running) {
      var sm = sd.summary;
      t += '<dl><dt>Sent</dt><dd>' + fmt(sm.sent) + ' files, ' + fmt(Math.round(sm.bytes / 1e5) / 10) + ' MB, in ' + fmt(sm.seconds) + ' seconds</dd>' +
        '<dt>Unchanged</dt><dd>' + fmt(sm.skipped) + ' already in the store from this pull</dd>' +
        (sm.failed ? '<dt>Failed</dt><dd class="err">' + fmt(sm.failed) + '</dd>' : '') +
        (sm.stop ? '<dt>Stopped early</dt><dd class="err">' + esc(sm.stop) + (sm.remaining ? ' ' + fmt(sm.remaining) + ' files are left for the next send.' : '') + '</dd>' : '') +
        '<dt>In the store</dt><dd>' + (sm.indexSent ? fmt(sm.inStore) + ' companies' + (sm.venues ? ': ' + Object.keys(sm.venues).sort().map(function (v) { return v + ' ' + fmt(sm.venues[v].companies); }).join(', ') : '') : 'the index was not rewritten, so the site still shows the previous send') + '</dd></dl>';
      if (sm.failures && sm.failures.length) t += '<pre>' + esc(sm.failures.join('\\n')) + '</pre>';
    }
    if (sd.error) t += '<div class="err">' + esc(sd.error) + '</div>';
    if (lastSendError) t += '<div class="err">' + esc(lastSendError) + '</div>';
    $('send-status').innerHTML = t;
    $('log').textContent = s.log.slice(-40).join('\\n');
  }
  function poll() {
    fetch('/api/state').then(function (r) { return r.json(); }).then(render).catch(function () {});
  }
  $('watchlist').addEventListener('change', function () { $('market').disabled = !!$('watchlist').value; });
  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    lastError = '';
    fetch('/api/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: $('token').value, remember: $('remember').checked, market: $('market').value, watchlist: $('watchlist').value, refresh: $('refresh').checked, limit: $('limit').value }) })
      .then(function (r) { return r.json(); }).then(function (j) { if (j.error) lastError = j.error; $('token').value = ''; poll(); });
  });
  $('stop').addEventListener('click', function () { fetch('/api/stop', { method: 'POST' }).then(poll); });
  $('send-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    lastSendError = '';
    fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: $('endpoint').value, bucket: $('bucket').value, accessKeyId: $('access-key').value, secretAccessKey: $('secret-key').value, remember: $('remember-keys').checked, all: $('send-all').checked }) })
      .then(function (r) { return r.json(); }).then(function (j) { if (j.error) lastSendError = j.error; else { $('access-key').value = ''; $('secret-key').value = ''; } poll(); });
  });
  $('send-stop').addEventListener('click', function () { fetch('/api/send-stop', { method: 'POST' }).then(poll); });
  poll();
  setInterval(poll, 1000);
})();
</script>
</body>
</html>
`;
