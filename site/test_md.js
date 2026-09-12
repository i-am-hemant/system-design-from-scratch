#!/usr/bin/env node
/* Tests for site/md.js — run: node site/test_md.js
 *
 * The escaping tests matter most: lesson content is rendered into innerHTML, so a
 * gap here is a script-injection bug.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// md.js attaches to window; give it one.
global.window = {};
eval(fs.readFileSync(path.join(__dirname, 'md.js'), 'utf8'));
const MD = global.window.MD;

let pass = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected;
  if (ok) {
    pass++;
  } else {
    failures.push(`${name}\n    got:      ${JSON.stringify(actual)}\n    expected: ${JSON.stringify(expected)}`);
  }
}

function contains(sub) {
  return (actual) => actual.includes(sub);
}
function excludes(sub) {
  return (actual) => !actual.includes(sub);
}

const r = (md) => MD.render(md).html;

// --- Security: escaping ----------------------------------------------------

check('escapes raw script tags', r('<script>alert(1)</script>'), excludes('<script>'));
check('escapes img onerror', r('<img src=x onerror=alert(1)>'), excludes('<img src=x'));
check(
  'escapes html inside code fence',
  r('```\n<script>bad()</script>\n```'),
  excludes('<script>bad')
);
check(
  'escapes html inside inline code',
  r('use `<script>` carefully'),
  contains('<code>&lt;script&gt;</code>')
);
check('escapes html in table cells', r('| a |\n| --- |\n| <b>x</b> |'), excludes('<b>x</b>'));
check('escapes html in headings', r('## <em>hi</em>'), excludes('<em>hi</em>'));
check('escapes html in blockquote', r('> <script>x</script>'), excludes('<script>'));
check('escapes html in list items', r('- <script>x</script>'), excludes('<script>'));

// --- Headings --------------------------------------------------------------

check('h1', r('# Title'), '<h1 id="title">Title</h1>');
check('h2 with id', r('## The problem'), '<h2 id="the-problem">The problem</h2>');
check(
  'heading ids strip punctuation',
  r('## What this does *not* solve'),
  contains('id="what-this-does-not-solve"')
);
check(
  'collects h2/h3 for the toc',
  MD.render('## A\n\n### B\n\n#### C').headings.map((h) => h.level + ':' + h.id).join(','),
  '2:a,3:b'
);

// --- Inline ----------------------------------------------------------------

check('bold', r('**strong**'), '<p><strong>strong</strong></p>');
check('italic asterisk', r('an *emphasis* here'), contains('<em>emphasis</em>'));
check('strikethrough', r('~~gone~~'), contains('<del>gone</del>'));
check('inline code', r('`code`'), '<p><code>code</code></p>');
check(
  'code span is not parsed as markup',
  r('`**not bold**`'),
  contains('<code>**not bold**</code>')
);
check('internal link', r('[docs](/catalog)'), contains('<a href="/catalog">docs</a>'));
check(
  'external link gets noopener',
  r('[x](https://example.com)'),
  contains('rel="noopener noreferrer"')
);
check('image', r('![alt](/a.png)'), contains('<img src="/a.png" alt="alt"'));

// --- Blocks ----------------------------------------------------------------

check('paragraph joins wrapped lines', r('one\ntwo'), '<p>one two</p>');
check('blank line splits paragraphs', r('a\n\nb'), '<p>a</p>\n<p>b</p>');
check('hr', r('---'), '<hr>');
check(
  'fenced code keeps language class',
  r('```go\nx := 1\n```'),
  contains('<code class="language-go">')
);
check('mermaid becomes a div', r('```mermaid\nflowchart LR\n```'), contains('<div class="mermaid">'));
check(
  'code fence preserves newlines',
  r('```\na\nb\n```'),
  contains('a\nb')
);

// --- Lists -----------------------------------------------------------------

check('unordered list', r('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
check('ordered list', r('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
check(
  'nested list',
  r('- a\n  - b'),
  contains('<ul><li>a</li><ul><li>b</li></ul></ul>')
);
check(
  'task list unchecked',
  r('- [ ] todo'),
  contains('type="checkbox" disabled>')
);
check('task list checked', r('- [x] done'), contains('checked>'));

// --- Tables ----------------------------------------------------------------

const table = r('| Name | Value |\n| --- | --- |\n| churn | 81% |');
check('table has thead', table, contains('<thead>'));
check('table header cells', table, contains('<th>Name</th>'));
check('table body cell', table, contains('churn'));
check('numeric cells get .num for alignment', table, contains('class="num"'));
check(
  'non-numeric cells do not get .num',
  r('| a |\n| --- |\n| hello |'),
  excludes('class="num">hello')
);

// --- Blockquote ------------------------------------------------------------

check('blockquote', r('> quoted'), '<blockquote><p>quoted</p></blockquote>');
check('multiline blockquote joins', r('> a\n> b'), contains('<p>a b</p>'));

// --- Real lesson: the parser must survive actual content -------------------

const lessonPath = path.join(
  __dirname,
  '..',
  'phases',
  '01-foundations',
  '03-consistent-hashing',
  'docs',
  'en.md'
);
if (fs.existsSync(lessonPath)) {
  const md = fs.readFileSync(lessonPath, 'utf8');
  const result = MD.render(md);
  check('real lesson renders non-empty', result.html.length > 5000, true);
  check('real lesson has headings for toc', result.headings.length >= 8, true);
  check('real lesson has no unescaped script', result.html, excludes('<script'));
  check('real lesson renders its tables', result.html, contains('<table>'));
  check('real lesson renders its mermaid', result.html, contains('class="mermaid"'));
  check(
    'real lesson keeps the churn figure',
    result.html,
    contains('81')
  );
  // No stray placeholder leakage from the inline-code pass.
  check('no placeholder leakage', result.html, excludes('\u0000'));
  check('no literal CODE markers', result.html, excludes('CODE0'));
} else {
  failures.push('reference lesson not found at ' + lessonPath);
}

// --- Report ----------------------------------------------------------------

if (failures.length) {
  console.error(`md.js: ${pass} passed, ${failures.length} FAILED\n`);
  failures.forEach((f) => console.error('  x ' + f + '\n'));
  process.exit(1);
}

// --- figures and URL safety ---------------------------------------------------

check('plain image renders in a figure', r('![ring](figures/ring.svg)'),
  contains('<span class="figure"><img src="figures/ring.svg"'));

check('image alt is escaped', r('![<script>x</script>](a.png)'), excludes('<script>'));

check('themed pair emits both variants',
  r('![ring](figures/ring-light.svg)'), contains('figures/ring-dark.svg'));

check('themed pair keeps the light variant',
  r('![ring](figures/ring-light.svg)'), contains('figures/ring-light.svg'));

check('themed pair is marked for CSS swapping',
  r('![ring](figures/ring-light.svg)'), contains('figure-themed'));

check('non-light svg is not paired',
  r('![x](figures/plain.svg)'), excludes('figure-themed'));

// A link target is an injection vector: lesson markdown is injected as innerHTML.
check('javascript: link is refused', r('[click](javascript:alert(1))'), excludes('javascript:'));
check('javascript: link degrades to text', r('[click](javascript:alert(1))'), contains('click'));
check('obfuscated javascript: is refused',
  r('[x](java\tscript:alert(1))'), excludes('script:alert'));
check('vbscript: link is refused', r('[x](vbscript:msgbox)'), excludes('vbscript:'));
check('data: svg image is refused', r('![x](data:image/svg+xml,<svg onload=alert(1)>)'),
  excludes('data:image/svg'));
check('data: png image is allowed',
  r('![x](data:image/png;base64,iVBORw0KGgo=)'), contains('data:image/png'));
check('quote in url cannot break the attribute',
  r('[x](http://a.com/"onmouseover="alert(1))'), excludes('onmouseover="alert'));
check('https link still works', r('[x](https://example.com)'), contains('href="https://example.com"'));
check('relative link still works', r('[x](../other/doc.md)'), contains('href="../other/doc.md"'));

console.log(`md.js: ${pass} checks passed`);
