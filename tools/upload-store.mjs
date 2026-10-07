#!/usr/bin/env node
// Send a pull to the site's store from the command line: the companies with
// statements, the screen rows and an index, into the R2 bucket the Worker
// reads at /api/data/. The local page (npm run pull-app) does the same with a
// button. The keys come from an R2 API token made in the Cloudflare dashboard
// (R2, then Manage R2 API Tokens, with Object Read & Write on the bucket) and
// never enter the repository or the site.
//
//   R2_ENDPOINT=https://<account id>.r2.cloudflarestorage.com \
//   R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… npm run upload-store
//   node tools/upload-store.mjs [--out data] [--bucket wwws-data] [--all] [--parallel 8]
//
// Files already in the bucket from the same pull are skipped (data/uploaded.json
// remembers them); --all sends everything again.

import { parseArgs } from './lib/pull.mjs';
import { uploadStore, DEFAULT_BUCKET } from './lib/store.mjs';

const args = parseArgs(process.argv.slice(2));
const env = process.env;
const fmt = n => Number(n).toLocaleString('en-US');
let last = 0;
try {
  const summary = await uploadStore({
    out: args.out || 'data',
    endpoint: env.R2_ENDPOINT || '',
    bucket: args.bucket || env.R2_BUCKET || DEFAULT_BUCKET,
    accessKeyId: env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
    all: !!args.all,
    parallel: args.parallel ? parseInt(args.parallel, 10) : 8,
    log: line => console.log(line),
    onProgress: p => {
      if (p.done - last >= 100 || p.done === p.total) { last = p.done; console.log('  ' + fmt(p.done) + ' of ' + fmt(p.total) + ' files, ' + fmt(Math.round(p.bytes / 1e5) / 10) + ' MB' + (p.failed ? ', ' + fmt(p.failed) + ' failed' : '')); }
    }
  });
  console.log('Sent ' + fmt(summary.sent) + ' files (' + fmt(Math.round(summary.bytes / 1e5) / 10) + ' MB) in ' + fmt(summary.seconds) + ' seconds; ' + fmt(summary.skipped) + ' unchanged, ' + fmt(summary.failed) + ' failed. The store lists ' + fmt(summary.inStore) + ' companies.');
  if (summary.failures.length) { console.log('Failures:'); summary.failures.forEach(f => console.log('  ' + f)); }
  process.exit(summary.failed ? 1 : 0);
} catch (e) {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
}
