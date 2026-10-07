// Sends a pull to the site's store: an R2 bucket in the owner's Cloudflare
// account, written here over R2's S3-compatible API with an R2 API token and
// read by src/worker.js at /api/data/, where the page opens any company in it
// without spending a call. Only what the site reads goes up: each company's
// file, the screen rows per venue, and an index of what is there. The raw
// replies and the rows folder stay on this machine. Nothing here touches the
// repository or the site's code. Needs Node 18 or later and nothing else.

import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { readJson, writeJson } from './pull.mjs';

export const DEFAULT_BUCKET = 'wwws-data';
export const SENT_FILE = 'uploaded.json';

export function sha256hex(data) { return createHash('sha256').update(data).digest('hex'); }
function hmac(key, data) { return createHmac('sha256', key).update(data, 'utf8').digest(); }
function encodeSegment(s) { return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }

// The path of an object in the bucket, each segment encoded once, as S3 wants it.
export function objectPath(bucket, key) {
  return '/' + [bucket].concat(key.split('/')).map(encodeSegment).join('/');
}

// AWS Signature Version 4 in its header form, which R2 accepts with region
// "auto" and service "s3". `headers` are the headers to sign besides host and
// x-amz-date, which are added; the payload hash is the request body's SHA-256.
export function sign(req) {
  const u = new URL(req.url);
  const date = req.date || new Date();
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const region = req.region || 'auto', service = req.service || 's3';
  const all = Object.assign({}, req.headers || {}, { host: u.host, 'x-amz-date': amzDate });
  const byName = {};
  for (const name of Object.keys(all)) byName[name.toLowerCase()] = String(all[name]).trim().replace(/\s+/g, ' ');
  const names = Object.keys(byName).sort();
  const canonicalHeaders = names.map(n => n + ':' + byName[n] + '\n').join('');
  const signedHeaders = names.join(';');
  const query = [];
  u.searchParams.forEach((value, name) => { query.push([encodeSegment(name), encodeSegment(value)]); });
  query.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const canonicalRequest = [req.method, u.pathname, query.map(p => p.join('=')).join('&'), canonicalHeaders, signedHeaders, req.payloadHash].join('\n');
  const scope = day + '/' + region + '/' + service + '/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + req.secretAccessKey, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return Object.assign({}, req.headers || {}, {
    'x-amz-date': amzDate,
    authorization: 'AWS4-HMAC-SHA256 Credential=' + req.accessKeyId + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature
  });
}

export class StoreError extends Error {
  constructor(message, fatal) { super(message); this.fatal = !!fatal; }
}

function explain(status, text) {
  if (status === 403) return new StoreError('R2 refused the keys (403): check the endpoint, the Access Key ID and the Secret Access Key, and that the token may read and write this bucket.', true);
  if (status === 404) return new StoreError('No such bucket at that endpoint (404): make the bucket in the Cloudflare dashboard first, under the same name.', true);
  if (status === 400) return new StoreError('R2 did not accept the request (400): ' + text.slice(0, 200).replace(/\s+/g, ' '), true);
  return new StoreError('R2 answered ' + status + (text ? ': ' + text.slice(0, 200).replace(/\s+/g, ' ') : ''), status < 500 && status !== 429);
}

// One object into the bucket. Retries a network error or a server-side
// failure a few times; a refusal stops at once with the reason.
export async function putObject(target, key, body, contentType) {
  const url = target.endpoint.replace(/\/+$/, '') + objectPath(target.bucket, key);
  const payloadHash = sha256hex(body);
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    const headers = sign({ method: 'PUT', url, headers: { 'content-type': contentType || 'application/json', 'x-amz-content-sha256': payloadHash }, payloadHash, accessKeyId: target.accessKeyId, secretAccessKey: target.secretAccessKey });
    let res;
    try {
      res = await fetch(url, { method: 'PUT', headers, body });
    } catch (e) {
      lastError = new StoreError('Could not reach ' + new URL(url).host + ': ' + (e && e.cause && e.cause.message ? e.cause.message : (e && e.message ? e.message : 'network error')), false);
      continue;
    }
    if (res.ok) {
      await res.arrayBuffer();
      return { etag: res.headers.get('etag') || '', bytes: body.length };
    }
    const text = await res.text().catch(() => '');
    lastError = explain(res.status, text);
    if (lastError.fatal) throw lastError;
  }
  throw lastError;
}

function yearsOf(c) {
  return new Set([].concat(Object.keys(c.income || {}), Object.keys(c.balance || {}), Object.keys(c.cashflow || {}))).size;
}

// What the site reads, from a pull on disk: each company with statements, the
// screen rows per venue and their index, plus index.json for the page.
export function planUpload(out, sent, all) {
  const manifest = readJson(path.join(out, 'pulled.json'));
  if (!manifest) throw new Error('No pull found at ' + out + ': run a pull first.');
  const screenIndex = readJson(path.join(out, 'screen', 'index.json'));
  if (!screenIndex || !screenIndex.venues) throw new Error('No screen files at ' + out + ': a pull writes them when it finishes.');
  const companies = {}, venues = {}, jobs = [];
  let skipped = 0, pulledUpTo = '';
  for (const symbol of Object.keys(manifest).sort()) {
    const m = manifest[symbol];
    if (!m || m.status !== 'ok') continue;
    const file = path.join(out, 'companies', symbol + '.json');
    if (!fs.existsSync(file)) continue;
    const row = readJson(path.join(out, 'rows', symbol + '.json'));
    let years = row && typeof row.years === 'number' ? row.years : null;
    if (years === null) { const c = readJson(file); years = c ? yearsOf(c) : 0; }
    if (!years) continue;
    const pulledAt = m.pulledAt || '';
    companies[symbol] = pulledAt.slice(0, 10);
    const venue = m.exchange || 'other';
    venues[venue] = venues[venue] || { companies: 0, pulledUpTo: '' };
    venues[venue].companies++;
    if (pulledAt > venues[venue].pulledUpTo) venues[venue].pulledUpTo = pulledAt;
    if (pulledAt > pulledUpTo) pulledUpTo = pulledAt;
    const key = 'companies/' + symbol + '.json';
    const was = sent.files[key];
    if (!all && was && was.pulledAt === pulledAt) { skipped++; continue; }
    jobs.push({ key, file, pulledAt });
  }
  for (const venue of Object.keys(screenIndex.venues).sort()) {
    const file = path.join(out, 'screen', venue + '.json');
    if (fs.existsSync(file)) jobs.push({ key: 'screen/' + venue + '.json', file, pulledAt: screenIndex.venues[venue].pulledUpTo || '' });
  }
  jobs.push({ key: 'screen/index.json', file: path.join(out, 'screen', 'index.json'), pulledAt: screenIndex.builtAt || '' });
  const index = { builtAt: new Date().toISOString(), pulledUpTo, venues, companies };
  return { jobs, index, skipped, inStore: Object.keys(companies).length };
}

// The whole send: plan, upload in parallel, remember what went, write the index last.
export async function uploadStore(opts) {
  const out = path.resolve(opts.out || 'data');
  const target = { endpoint: String(opts.endpoint || '').trim(), bucket: String(opts.bucket || DEFAULT_BUCKET).trim(), accessKeyId: String(opts.accessKeyId || '').trim(), secretAccessKey: String(opts.secretAccessKey || '').trim() };
  const log = opts.log || (() => {}), onProgress = opts.onProgress || (() => {}), shouldStop = opts.shouldStop || (() => false);
  const parallel = Math.max(1, opts.parallel || 8);
  if (!/^https?:\/\/[^/]+/.test(target.endpoint)) throw new Error('The S3 endpoint should look like https://<account id>.r2.cloudflarestorage.com');
  if (!target.accessKeyId || !target.secretAccessKey) throw new Error('The Access Key ID and the Secret Access Key are both needed.');
  if (!target.bucket) throw new Error('Name the bucket.');
  const sentFile = path.join(out, SENT_FILE);
  let sent = readJson(sentFile);
  if (!sent || sent.endpoint !== target.endpoint || sent.bucket !== target.bucket || !sent.files) sent = { endpoint: target.endpoint, bucket: target.bucket, files: {} };
  const plan = planUpload(out, sent, !!opts.all);
  const started = Date.now();
  const progress = { total: plan.jobs.length + 1, done: 0, sent: 0, skipped: plan.skipped, failed: 0, bytes: 0, current: '' };
  log('Sending ' + plan.jobs.length + ' files to ' + target.bucket + (plan.skipped ? ', ' + plan.skipped + ' already there unchanged' : '') + '.');
  onProgress(progress);
  let stop = '', fatal = null, failures = [];
  const queue = plan.jobs.slice();
  let sinceSave = 0;
  const save = () => { sent.sentAt = new Date().toISOString(); writeJson(sentFile, sent); };
  async function worker() {
    for (;;) {
      if (fatal) return;
      if (shouldStop()) { stop = 'stopped by you'; return; }
      const job = queue.shift();
      if (!job) return;
      progress.current = job.key;
      try {
        const body = job.body || fs.readFileSync(job.file);
        const r = await putObject(target, job.key, body, 'application/json');
        sent.files[job.key] = { pulledAt: job.pulledAt, bytes: r.bytes, etag: r.etag, sentAt: new Date().toISOString() };
        progress.sent++; progress.bytes += r.bytes;
        if (++sinceSave >= 200) { sinceSave = 0; save(); }
      } catch (e) {
        if (e && e.fatal) { if (!fatal) { fatal = e; log('Stopped: ' + e.message); } return; }
        progress.failed++;
        failures.push(job.key + ': ' + (e && e.message ? e.message : String(e)));
        if (failures.length <= 20) log('Failed ' + job.key + ': ' + (e && e.message ? e.message : e));
      }
      progress.done++;
      onProgress(progress);
    }
  }
  await Promise.all(Array.from({ length: parallel }, worker));
  const remaining = queue.length;
  let indexSent = false;
  if (!fatal && !stop && !progress.failed) {
    try {
      progress.current = 'index.json';
      const body = Buffer.from(JSON.stringify(plan.index));
      await putObject(target, 'index.json', body, 'application/json');
      indexSent = true;
      progress.sent++; progress.bytes += body.length;
    } catch (e) {
      if (e && e.fatal) fatal = e;
      progress.failed++;
      failures.push('index.json: ' + (e && e.message ? e.message : String(e)));
    }
  }
  progress.done++;
  progress.current = '';
  onProgress(progress);
  save();
  const summary = {
    files: plan.jobs.length + 1, sent: progress.sent, skipped: plan.skipped, failed: progress.failed, bytes: progress.bytes, remaining,
    inStore: plan.inStore, venues: plan.index.venues, indexSent, seconds: Math.round((Date.now() - started) / 1000),
    stop: fatal ? fatal.message : stop, failures: failures.slice(0, 20)
  };
  if (fatal) throw Object.assign(fatal, { summary });
  log('Done: ' + summary.sent + ' sent, ' + summary.skipped + ' unchanged, ' + summary.failed + ' failed' + (remaining ? ', ' + remaining + ' left for next time' : '') + (indexSent ? '; the index now lists ' + plan.inStore + ' companies.' : '; the index was not rewritten.'));
  return summary;
}
