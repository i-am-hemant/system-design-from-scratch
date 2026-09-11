#!/usr/bin/env node
/**
 * Local preview server that applies the same routing as production.
 *
 *   node scripts/serve.js            # http://localhost:8080
 *   node scripts/serve.js --port 3000
 *
 * Why this exists: `python3 -m http.server` serves raw files, so the clean URLs
 * declared in vercel.json (/catalog, /about, /lesson) return 404 locally while
 * working in production. Testing against a server that routes differently from
 * production is how routing bugs reach users.
 *
 * Routing is READ FROM vercel.json rather than duplicated here, so the two
 * cannot drift apart.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SITE = path.join(REPO, 'site');
const VERCEL = path.join(REPO, 'vercel.json');

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx !== -1 ? Number(args[portIdx + 1]) : 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

function loadRewrites() {
  try {
    const cfg = JSON.parse(fs.readFileSync(VERCEL, 'utf8'));
    return {
      rewrites: cfg.rewrites || [],
      cleanUrls: cfg.cleanUrls === true,
    };
  } catch (err) {
    console.warn('warning: could not read vercel.json (' + err.message + ')');
    return { rewrites: [], cleanUrls: false };
  }
}

const { rewrites, cleanUrls } = loadRewrites();

function resolvePath(pathname) {
  // 1. Explicit rewrites from vercel.json.
  for (const rule of rewrites) {
    if (rule.source === pathname) return rule.destination;
  }

  // 2. Root.
  if (pathname === '/') return '/index.html';

  // 3. cleanUrls: /about -> /about.html
  if (cleanUrls && !path.extname(pathname)) {
    const candidate = pathname.replace(/\/$/, '') + '.html';
    if (fs.existsSync(path.join(SITE, candidate))) return candidate;
  }

  return pathname;
}

// Repository files (lesson markdown, quiz.json) live outside site/ and the
// lesson page fetches them with a '../' prefix in local preview.
function locate(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const inSite = path.join(SITE, clean);
  if (fs.existsSync(inSite) && fs.statSync(inSite).isFile()) return inSite;

  const inRepo = path.join(REPO, clean);
  if (fs.existsSync(inRepo) && fs.statSync(inRepo).isFile()) return inRepo;

  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const target = resolvePath(url.pathname);
  const file = locate(target);

  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<h1>404</h1><p>No file for <code>' +
        url.pathname +
        '</code> (resolved to <code>' +
        target +
        '</code>)</p><p><a href="/">home</a> · <a href="/catalog">catalog</a></p>'
    );
    console.log('404 ' + url.pathname);
    return;
  }

  // Guard against path traversal out of the repository.
  const real = fs.realpathSync(file);
  if (!real.startsWith(fs.realpathSync(REPO))) {
    res.writeHead(403).end('forbidden');
    return;
  }

  const body = fs.readFileSync(real);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(real)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(body);
  console.log('200 ' + url.pathname + (target !== url.pathname ? ' -> ' + target : ''));
});

// Always build before serving so the catalog reflects what is on disk.
try {
  execFileSync('node', [path.join(SITE, 'build.js')], { stdio: 'inherit' });
} catch (err) {
  console.error('build failed; serving whatever data.js exists');
}

server.listen(PORT, () => {
  console.log('\n  System Design from Scratch — local preview');
  console.log('  http://localhost:' + PORT + '\n');
  console.log('  /                                       home');
  console.log('  /catalog                                curriculum');
  console.log('  /about                                  method and credits');
  console.log('  /lesson?id=01-foundations/03-consistent-hashing');
  console.log('  /llms.txt                               agent-readable map\n');
  console.log('  Routing is read from vercel.json, so these are the production URLs.');
  console.log('  Ctrl-C to stop.\n');
});
