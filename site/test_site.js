#!/usr/bin/env node
/* Site build artifact tests — run: node site/test_site.js
 *
 * Checks the things that silently break a curriculum site:
 *   - the build emits data.js / llms.txt / sitemap.xml
 *   - every lesson the catalog links to actually exists on disk
 *   - no lesson is advertised as available without a doc
 *   - pages reference only scripts that exist
 *   - quiz staging uses the pre/check/post convention
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SITE = __dirname;
const REPO = path.resolve(SITE, '..');

let pass = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) pass++;
  else failures.push(name + (detail ? '\n      ' + detail : ''));
}

// --- build outputs exist ---------------------------------------------------

for (const f of ['data.js', 'llms.txt', 'sitemap.xml', 'style.css', 'app.js', 'md.js']) {
  check(`site/${f} exists`, fs.existsSync(path.join(SITE, f)));
}
for (const f of ['index.html', 'catalog.html', 'about.html', 'lesson.html']) {
  check(`site/${f} exists`, fs.existsSync(path.join(SITE, f)));
}

// --- data.js integrity ----------------------------------------------------

global.window = {};
eval(fs.readFileSync(path.join(SITE, 'data.js'), 'utf8'));
const data = global.window.CURRICULUM;

check('data.js defines CURRICULUM', !!data);
check('has phases', Array.isArray(data.phases) && data.phases.length > 0);
check('has stats', !!data.stats);
check(
  'at least one lesson is available',
  data.stats.lessonsAvailable > 0,
  `got ${data.stats.lessonsAvailable}`
);
check(
  'available count matches phase data',
  data.stats.lessonsAvailable ===
    data.phases.reduce((n, p) => n + p.lessons.filter((l) => l.available).length, 0)
);

// Every available lesson must have a real doc on disk. This is the check that
// keeps the site from advertising work that was never done.
for (const phase of data.phases) {
  for (const lesson of phase.lessons) {
    if (!lesson.available) {
      check(
        `planned lesson ${phase.slug}/${lesson.slug} has no docPath`,
        !lesson.docPath,
        'planned lessons must not claim a doc'
      );
      continue;
    }
    const docAbs = path.join(REPO, lesson.docPath);
    check(
      `${phase.slug}/${lesson.slug}: doc exists on disk`,
      fs.existsSync(docAbs),
      lesson.docPath
    );
    check(
      `${phase.slug}/${lesson.slug}: has a title`,
      !!lesson.title && lesson.title.length > 2
    );
    check(
      `${phase.slug}/${lesson.slug}: type is known`,
      /concept|build|simulate|design/.test(lesson.type || ''),
      `got "${lesson.type}"`
    );
    if (lesson.hasCode) {
      check(
        `${phase.slug}/${lesson.slug}: code has tests`,
        lesson.hasTests,
        'a build lesson without tests cannot be verified'
      );
    }
    // Quiz staging convention: pre / check / post.
    const quizPath = path.join(REPO, 'phases', phase.slug, lesson.slug, 'quiz.json');
    if (fs.existsSync(quizPath)) {
      const quiz = JSON.parse(fs.readFileSync(quizPath, 'utf8'));
      const stages = new Set((quiz.questions || []).map((q) => q.stage));
      check(
        `${phase.slug}/${lesson.slug}: quiz uses known stages`,
        [...stages].every((s) => ['pre', 'check', 'post'].includes(s)),
        `got ${[...stages].join(',')}`
      );
      check(
        `${phase.slug}/${lesson.slug}: quizCount matches file`,
        lesson.quizCount === (quiz.questions || []).length
      );
    }
  }
}

// --- llms.txt -------------------------------------------------------------

const llms = fs.readFileSync(path.join(SITE, 'llms.txt'), 'utf8');
check('llms.txt has a title', llms.startsWith('# System Design from Scratch'));
check('llms.txt lists lesson types', llms.includes('Build:') && llms.includes('Design:'));
check(
  'llms.txt marks planned lessons honestly',
  llms.includes('planned, not yet written')
);
check(
  'llms.txt links the written lesson',
  llms.includes('/lesson?id=03-data-storage/08-consistent-hashing')
);

// --- sitemap only lists real pages ---------------------------------------

const sitemap = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check('sitemap has entries', locs.length > 0);
const plannedSlugs = data.phases
  .flatMap((p) => p.lessons.filter((l) => !l.available).map((l) => `${p.slug}/${l.slug}`));
check(
  'sitemap excludes planned lessons',
  !locs.some((u) => plannedSlugs.some((s) => u.includes(s))),
  'a sitemap entry pointed at an unwritten lesson'
);

// --- pages reference only local files that exist -------------------------

for (const page of ['index.html', 'catalog.html', 'about.html', 'lesson.html', '404.html']) {
  // A missing page is reported by its own existence check below; crashing here
  // would hide every remaining failure behind a stack trace.
  if (!fs.existsSync(path.join(SITE, page))) {
    check(`site/${page} exists`, false);
    continue;
  }
  const html = fs.readFileSync(path.join(SITE, page), 'utf8');
  const refs = [
    ...html.matchAll(/(?:src|href)="(?!https?:|data:|#|\/lesson|\/catalog|\/about|\/llms|\/)([^"]+)"/g),
  ].map((m) => m[1]);
  for (const ref of new Set(refs)) {
    check(`${page} references existing ${ref}`, fs.existsSync(path.join(SITE, ref)));
  }
  check(`${page} sets a viewport`, html.includes('name="viewport"'));
  check(`${page} has a skip link`, html.includes('skip-link'));
  check(`${page} declares a title`, /<title>[^<]+<\/title>/.test(html));
}

// --- Cloudflare Pages deploy invariants ----------------------------------
//
// These are not cosmetic. Pages infers behaviour from the presence of files, so
// deleting one silently changes how the whole site is served.

// Without a top-level 404.html, Pages decides the project is a single-page app
// and serves index.html — with a 200 — for every unknown path. Typos and dead
// links would then look like the homepage, and crawlers would index duplicates.
check(
  'site/404.html exists (absence turns Pages into SPA mode)',
  fs.existsSync(path.join(SITE, '404.html'))
);

const headersPath = path.join(SITE, '_headers');
check('site/_headers exists', fs.existsSync(headersPath));
if (fs.existsSync(headersPath)) {
  const headers = fs.readFileSync(headersPath, 'utf8');
  // Pages serves .txt as text/plain; llms.txt is markdown for agents.
  check(
    '_headers serves llms.txt as markdown',
    /^\/llms\.txt$/m.test(headers) && /Content-Type:\s*text\/markdown/.test(headers)
  );
  // data.js is regenerated on every build; a cached copy misstates the catalog.
  check(
    '_headers keeps data.js revalidated',
    /^\/data\.js$/m.test(headers) && /no-cache/.test(headers)
  );
  // Rule lines must be indented under their path, or Pages ignores them.
  const badRule = headers
    .split('\n')
    .some((l) => /^[A-Za-z-]+:\s/.test(l) && !/^(https?):/.test(l));
  check('_headers rules are indented under their path', !badRule);
}

// Canonical host must be consistent: a split canonical splits search ranking.
const SITE_HOST = 'sysdesign.hemantfaujdar.com';
for (const f of ['index.html', 'catalog.html', 'about.html', 'lesson.html', 'robots.txt', 'sitemap.xml', 'llms.txt']) {
  const text = fs.readFileSync(path.join(SITE, f), 'utf8');
  const hosts = [...text.matchAll(/https:\/\/([a-z0-9.-]*from-?scratch[a-z0-9.-]*)/gi)].map((m) => m[1]);
  check(
    `${f} points at ${SITE_HOST}, not a stale domain`,
    hosts.every((h) => h.endsWith('github.com') || h.endsWith('githubusercontent.com')),
    hosts.join(', ')
  );
}
check(
  'robots.txt advertises the sitemap on the canonical host',
  fs.readFileSync(path.join(SITE, 'robots.txt'), 'utf8').includes(`https://${SITE_HOST}/sitemap.xml`)
);

// --- report ---------------------------------------------------------------

if (failures.length) {
  console.error(`site: ${pass} passed, ${failures.length} FAILED\n`);
  failures.forEach((f) => console.error('  x ' + f));
  process.exit(1);
}
console.log(`site: ${pass} checks passed`);
