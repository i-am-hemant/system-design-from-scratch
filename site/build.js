#!/usr/bin/env node
/**
 * Build the System Design from Scratch site.
 *
 *   node site/build.js
 *
 * Scans phases/ on disk and emits:
 *   site/data.js        curriculum data consumed by the pages
 *   site/llms.txt       a markdown map of the curriculum, for agents
 *   site/sitemap.xml
 *
 * Deliberate difference from the reference project: the source of truth is the
 * FILESYSTEM, not README.md. A lesson exists on the site only if its directory
 * and docs/en.md exist. That makes it impossible for the site to advertise
 * lessons that were never written — the failure mode of every curriculum repo.
 *
 * Planned-but-unwritten lessons come from curriculum.json, and are rendered as
 * explicitly unavailable rather than as links.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const PHASES_DIR = path.join(REPO, 'phases');
const CURRICULUM_PATH = path.join(REPO, 'curriculum.json');
const SITE = __dirname;
const SITE_URL = 'https://systemdesignfromscratch.com';

// --- helpers ---------------------------------------------------------------

function titleFromSlug(slug) {
  return slug
    .replace(/^\d+-/, '')
    .split('-')
    .map((w) => (w.length <= 2 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

function readIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** First H1 in a markdown document. */
function extractTitle(md) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

/** The blockquote immediately following the H1 — every lesson's hook. */
function extractHook(md) {
  const m = md.match(/^#\s+.+\n+((?:>\s?.*\n?)+)/m);
  if (!m) return null;
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^>\s?/, '').trim())
    .filter(Boolean)
    .join(' ');
}

/** `**Key:** value` header fields. */
function extractField(md, key) {
  const re = new RegExp(`^\\*\\*${key}:\\*\\*\\s*(.+)$`, 'im');
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

function extractSections(md) {
  return [...md.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
}

function slugifyHeading(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function countWords(md) {
  return md.split(/\s+/).filter(Boolean).length;
}

// --- scan ------------------------------------------------------------------

function scanLesson(phaseSlug, lessonSlug) {
  const dir = path.join(PHASES_DIR, phaseSlug, lessonSlug);
  const md = readIfExists(path.join(dir, 'docs', 'en.md'));
  if (md === null) return null;

  const codeDir = path.join(dir, 'code');
  const goFiles = fs.existsSync(codeDir)
    ? fs.readdirSync(codeDir, { recursive: true }).filter((f) => String(f).endsWith('.go'))
    : [];

  const designDir = path.join(dir, 'design');
  const designs = fs.existsSync(designDir)
    ? fs.readdirSync(designDir).filter((f) => f.endsWith('.md'))
    : [];

  let quizCount = 0;
  const quizRaw = readIfExists(path.join(dir, 'quiz.json'));
  if (quizRaw) {
    try {
      quizCount = (JSON.parse(quizRaw).questions || []).length;
    } catch {
      console.warn(`   ! ${phaseSlug}/${lessonSlug}: quiz.json does not parse`);
    }
  }

  const rawType = extractField(md, 'Type') || 'build';

  return {
    slug: lessonSlug,
    num: parseInt(lessonSlug, 10) || null,
    title: extractTitle(md) || titleFromSlug(lessonSlug),
    hook: extractHook(md),
    type: rawType.toLowerCase(),
    language: extractField(md, 'Language') || extractField(md, 'Languages'),
    time: extractField(md, 'Time'),
    prerequisites: extractField(md, 'Prerequisites'),
    sections: extractSections(md).map((s) => ({ title: s, id: slugifyHeading(s) })),
    words: countWords(md),
    docPath: `phases/${phaseSlug}/${lessonSlug}/docs/en.md`,
    hasCode: goFiles.length > 0,
    hasTests: goFiles.some((f) => String(f).endsWith('_test.go')),
    goFileCount: goFiles.length,
    designs: designs.map((f) => ({
      file: f,
      title: extractTitle(readIfExists(path.join(designDir, f)) || '') || f,
      path: `phases/${phaseSlug}/${lessonSlug}/design/${f}`,
    })),
    quizCount,
    available: true,
  };
}

function scanPhases() {
  if (!fs.existsSync(PHASES_DIR)) return [];
  return fs
    .readdirSync(PHASES_DIR)
    .filter((d) => fs.statSync(path.join(PHASES_DIR, d)).isDirectory())
    .sort()
    .map((phaseSlug) => {
      const phaseDir = path.join(PHASES_DIR, phaseSlug);
      const lessons = fs
        .readdirSync(phaseDir)
        .filter((d) => fs.statSync(path.join(phaseDir, d)).isDirectory())
        .sort()
        .map((lessonSlug) => scanLesson(phaseSlug, lessonSlug))
        .filter(Boolean);
      return {
        slug: phaseSlug,
        num: parseInt(phaseSlug, 10) || null,
        title: titleFromSlug(phaseSlug),
        lessons,
      };
    });
}

/** Merge planned lessons from curriculum.json, marked unavailable. */
function mergePlanned(phases) {
  const planned = readIfExists(CURRICULUM_PATH);
  if (!planned) return phases;

  let outline;
  try {
    outline = JSON.parse(planned);
  } catch (err) {
    console.warn(`   ! curriculum.json does not parse: ${err.message}`);
    return phases;
  }

  const byslug = new Map(phases.map((p) => [p.slug, p]));

  for (const plannedPhase of outline.phases || []) {
    let phase = byslug.get(plannedPhase.slug);
    if (!phase) {
      phase = {
        slug: plannedPhase.slug,
        num: parseInt(plannedPhase.slug, 10) || null,
        title: plannedPhase.title || titleFromSlug(plannedPhase.slug),
        lessons: [],
      };
      byslug.set(phase.slug, phase);
      phases.push(phase);
    }
    if (plannedPhase.title) phase.title = plannedPhase.title;
    phase.summary = plannedPhase.summary || null;

    const haveSlugs = new Set(phase.lessons.map((l) => l.slug));
    for (const plannedLesson of plannedPhase.lessons || []) {
      if (haveSlugs.has(plannedLesson.slug)) continue;
      phase.lessons.push({
        slug: plannedLesson.slug,
        num: parseInt(plannedLesson.slug, 10) || null,
        title: plannedLesson.title || titleFromSlug(plannedLesson.slug),
        type: (plannedLesson.type || 'build').toLowerCase(),
        available: false,
        sections: [],
        designs: [],
        quizCount: 0,
      });
    }
    phase.lessons.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  return [...byslug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

// --- emit ------------------------------------------------------------------

function stats(phases) {
  const all = phases.flatMap((p) => p.lessons);
  const done = all.filter((l) => l.available);
  return {
    phases: phases.length,
    lessonsPlanned: all.length,
    lessonsAvailable: done.length,
    withCode: done.filter((l) => l.hasCode).length,
    withTests: done.filter((l) => l.hasTests).length,
    designExercises: done.reduce((n, l) => n + l.designs.length, 0),
    quizQuestions: done.reduce((n, l) => n + l.quizCount, 0),
    words: done.reduce((n, l) => n + (l.words || 0), 0),
    generated: new Date().toISOString().slice(0, 10),
  };
}

function writeData(phases, s) {
  const banner =
    '/* GENERATED by site/build.js from the phases/ directory. Do not edit by hand. */\n';
  const body =
    `window.CURRICULUM = ${JSON.stringify({ stats: s, phases }, null, 2)};\n`;
  fs.writeFileSync(path.join(SITE, 'data.js'), banner + body, 'utf8');
  console.log(`   wrote data.js (${s.lessonsAvailable}/${s.lessonsPlanned} lessons available)`);
}

function writeLlmsTxt(phases, s) {
  const lines = [
    '# System Design from Scratch',
    '',
    '> A free, open-source curriculum that builds system design mechanisms in Go,',
    '> measures their trade-offs, and grades design judgement against rubrics.',
    '> No claim without a number the lesson produced.',
    '',
    `Generated ${s.generated}. ${s.lessonsAvailable} of ${s.lessonsPlanned} planned lessons written.`,
    '',
    '## Lesson types',
    '',
    '- Build: a real algorithm implemented in Go with tests that assert the trade-off',
    '- Simulate: a measurable experiment for systems too large to build in a lesson',
    '- Design: a brief with a self-scoring rubric, traps, and a reference direction',
    '',
    '## Curriculum',
    '',
  ];

  for (const phase of phases) {
    lines.push(`### ${phase.title}`);
    if (phase.summary) lines.push('', phase.summary);
    lines.push('');
    for (const lesson of phase.lessons) {
      if (!lesson.available) {
        lines.push(`- ${lesson.title} (${lesson.type}) — planned, not yet written`);
        continue;
      }
      const url = `${SITE_URL}/lesson?id=${phase.slug}/${lesson.slug}`;
      lines.push(`- [${lesson.title}](${url}) (${lesson.type})`);
      if (lesson.hook) lines.push(`  ${lesson.hook}`);
    }
    lines.push('');
  }

  lines.push('## Source', '', `Repository: https://github.com/i-am-hemant/system-design-from-scratch`, '');
  fs.writeFileSync(path.join(SITE, 'llms.txt'), lines.join('\n'), 'utf8');
  console.log('   wrote llms.txt');
}

function writeSitemap(phases) {
  const urls = [
    `${SITE_URL}/`,
    `${SITE_URL}/catalog`,
    `${SITE_URL}/about`,
  ];
  for (const phase of phases) {
    for (const lesson of phase.lessons) {
      if (lesson.available) {
        urls.push(`${SITE_URL}/lesson?id=${phase.slug}/${lesson.slug}`);
      }
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(
      (u) =>
        `  <url><loc>${u.replace(/&/g, '&amp;')}</loc><lastmod>${today}</lastmod></url>`
    ),
    '</urlset>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(SITE, 'sitemap.xml'), xml, 'utf8');
  console.log(`   wrote sitemap.xml (${urls.length} urls)`);
}

// --- main ------------------------------------------------------------------

function main() {
  console.log('building System Design from Scratch site');
  let phases = scanPhases();
  phases = mergePlanned(phases);
  const s = stats(phases);

  writeData(phases, s);
  writeLlmsTxt(phases, s);
  writeSitemap(phases);

  console.log(
    `\n   ${s.phases} phases | ${s.lessonsAvailable} written | ` +
      `${s.withTests} with tests | ${s.designExercises} design exercises | ` +
      `${s.quizQuestions} quiz questions`
  );

  if (s.lessonsAvailable === 0) {
    console.error('\nerror: no lessons found — refusing to build an empty site');
    process.exit(1);
  }
  if (s.withCode > 0 && s.withTests < s.withCode) {
    console.warn(
      `\n   ! ${s.withCode - s.withTests} lesson(s) have code but no tests`
    );
  }
}

if (require.main === module) main();

module.exports = { scanPhases, mergePlanned, stats, extractHook, extractField, slugifyHeading };
