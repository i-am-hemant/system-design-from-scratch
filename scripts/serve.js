#!/usr/bin/env node
/**
 * Local preview server that applies the same routing as production.
 *
 *   node scripts/serve.js            # http://localhost:8080
 *   node scripts/serve.js --port 3000
 *
 * Why this exists: `python3 -m http.server` serves raw files, so the clean URLs
 * the host produces (/catalog, /about, /lesson) return 404 locally while working
 * in production. Testing against a server that routes differently from
 * production is how routing bugs reach users.
 *
 * Production is Cloudflare Pages, whose routing is implicit rather than
 * declared in a config file:
 *
 *   - /about resolves to /about.html, and /about.html REDIRECTS to /about
 *   - an unmatched path serves /404.html with a 404 status (and only behaves
 *     like a single-page app if no top-level 404.html exists, which is why
 *     site/404.html must stay)
 *
 * Those two rules are reimplemented below. There is no config file to read, so
 * a change in Pages behaviour has to be mirrored here by hand.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SITE = path.join(REPO, 'site');

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

function resolvePath(pathname) {
  if (pathname === '/') return '/index.html';

  // Pages maps an extensionless path to its .html file.
  if (!path.extname(pathname)) {
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

  // Pages redirects /about.html to /about, so a link written with the extension
  // must not appear to work locally.
  if (/\.html$/.test(url.pathname)) {
    const clean = url.pathname === '/index.html' ? '/' : url.pathname.replace(/\.html$/, '');
    res.writeHead(308, { Location: clean + url.search });
    res.end();
    console.log('308 ' + url.pathname + ' -> ' + clean);
    return;
  }

  const target = resolvePath(url.pathname);
  const file = locate(target);

  if (!file) {
    // Serve the real 404 page, exactly as Pages does.
    const notFound = path.join(SITE, '404.html');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : '<h1>404</h1>');
    console.log('404 ' + url.pathname + ' (resolved to ' + target + ')');
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
  console.log('  /lesson?id=03-data-storage/08-consistent-hashing');
  console.log('  /llms.txt                               agent-readable map\n');
  console.log('  Routing mirrors Cloudflare Pages, so these are the production URLs.');
  console.log('  Ctrl-C to stop.\n');
});
