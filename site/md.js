/* md.js — a small, dependency-free markdown renderer.
 *
 * Deliberately not a general-purpose parser. It supports exactly what the
 * lesson docs in this repo use:
 *
 *   headings, paragraphs, bold/italic/inline code, links, images
 *   fenced code blocks (with mermaid passthrough)
 *   unordered and ordered lists, nested one level
 *   blockquotes, tables, horizontal rules, task-list checkboxes
 *
 * Everything is HTML-escaped before any markup is inserted, so lesson content
 * cannot inject script. That is the reason this exists rather than a CDN parser:
 * one file, auditable, no supply chain.
 */

(function () {
  'use strict';

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
  }

  /** Inline formatting. Input must already be HTML-escaped. */
  function inline(text) {
    var out = text;

    // Inline code first, so its contents are not treated as markup. Placeholders
    // keep the code spans out of the way of later replacements.
    var codes = [];
    out = out.replace(/`([^`]+)`/g, function (_, code) {
      codes.push(code);
      return '\u0000CODE' + (codes.length - 1) + '\u0000';
    });

    // Images before links: same bracket syntax, leading !
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, src) {
      return '<img src="' + src + '" alt="' + alt + '" loading="lazy">';
    });

    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, href) {
      var external = /^https?:/.test(href);
      return (
        '<a href="' +
        href +
        '"' +
        (external ? ' target="_blank" rel="noopener noreferrer"' : '') +
        '>' +
        label +
        '</a>'
      );
    });

    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/(^|\W)_([^_\n]+)_(\W|$)/g, '$1<em>$2</em>$3');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    out = out.replace(/\u0000CODE(\d+)\u0000/g, function (_, i) {
      return '<code>' + codes[Number(i)] + '</code>';
    });

    return out;
  }

  function renderTable(rows) {
    // rows[1] is the alignment row; drop it.
    var header = rows[0];
    var align = (rows[1] || '').split('|').map(function (c) {
      var t = c.trim();
      if (/^:-+:$/.test(t)) return 'center';
      if (/^-+:$/.test(t)) return 'right';
      return '';
    });
    var body = rows.slice(2);

    function cells(line) {
      var trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
      return trimmed.split('|').map(function (c) {
        return c.trim();
      });
    }

    var html = '<table><thead><tr>';
    cells(header).forEach(function (c, i) {
      var a = align[i + (align[0] === '' && align.length > cells(header).length ? 1 : 0)] || '';
      html += '<th' + (a ? ' style="text-align:' + a + '"' : '') + '>' + inline(c) + '</th>';
    });
    html += '</tr></thead><tbody>';
    body.forEach(function (line) {
      html += '<tr>';
      cells(line).forEach(function (c, i) {
        var a = align[i] || '';
        // Right-align cells that are purely numeric/measurement-like.
        var numeric = /^[~<>≈]?\s*[\d.,]+\s*(%|x|ms|s|GB|TB|MB|KB|Gb\/s|QPS)?$/i.test(c);
        var cls = numeric ? ' class="num"' : '';
        html +=
          '<td' + cls + (a ? ' style="text-align:' + a + '"' : '') + '>' + inline(c) + '</td>';
      });
      html += '</tr>';
    });
    return html + '</tbody></table>';
  }

  function render(md) {
    var src = String(md).replace(/\r\n?/g, '\n');
    var lines = src.split('\n');
    var out = [];
    var headings = [];
    var i = 0;

    function flushParagraph(buf) {
      if (!buf.length) return;
      out.push('<p>' + inline(escapeHtml(buf.join(' '))) + '</p>');
      buf.length = 0;
    }

    var para = [];

    while (i < lines.length) {
      var line = lines[i];

      // Fenced code
      var fence = line.match(/^```\s*(\w+)?\s*$/);
      if (fence) {
        flushParagraph(para);
        var lang = fence[1] || '';
        var buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++; // closing fence
        var body = buf.join('\n');
        if (lang === 'mermaid') {
          // Passed through for mermaid.js to pick up if it is loaded; if not, it
          // still reads as the diagram source rather than vanishing.
          out.push('<div class="mermaid">' + escapeHtml(body) + '</div>');
        } else {
          out.push(
            '<pre><code' +
              (lang ? ' class="language-' + lang + '"' : '') +
              '>' +
              escapeHtml(body) +
              '</code></pre>'
          );
        }
        continue;
      }

      // Heading
      var h = line.match(/^(#{1,4})\s+(.+)$/);
      if (h) {
        flushParagraph(para);
        var level = h[1].length;
        var raw = h[2].trim();
        var id = slugify(raw);
        if (level === 2 || level === 3) headings.push({ level: level, text: raw, id: id });
        out.push(
          '<h' + level + ' id="' + id + '">' + inline(escapeHtml(raw)) + '</h' + level + '>'
        );
        i++;
        continue;
      }

      // Horizontal rule
      if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())) {
        flushParagraph(para);
        out.push('<hr>');
        i++;
        continue;
      }

      // Table: a header line followed by an alignment line
      if (/\|/.test(line) && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
        flushParagraph(para);
        var rows = [];
        while (i < lines.length && /\|/.test(lines[i])) {
          rows.push(escapeHtml(lines[i]));
          i++;
        }
        out.push(renderTable(rows));
        continue;
      }

      // Blockquote
      if (/^>\s?/.test(line)) {
        flushParagraph(para);
        var quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        out.push('<blockquote><p>' + inline(escapeHtml(quote.join(' '))) + '</p></blockquote>');
        continue;
      }

      // Lists (one level of nesting)
      var listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      if (listMatch) {
        flushParagraph(para);
        var ordered = /\d/.test(listMatch[2]);
        var tag = ordered ? 'ol' : 'ul';
        var html = '<' + tag + '>';
        var openNested = false;

        while (i < lines.length) {
          var m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
          if (!m) {
            // A continuation line belonging to the previous item.
            if (/^\s+\S/.test(lines[i]) && lines[i].trim()) {
              html += ' ' + inline(escapeHtml(lines[i].trim()));
              i++;
              continue;
            }
            break;
          }
          var indent = m[1].length;
          var content = m[3];

          // Task-list checkbox
          var task = content.match(/^\[([ xX])\]\s*(.*)$/);
          var itemHtml;
          if (task) {
            itemHtml =
              '<label><input type="checkbox" disabled' +
              (task[1].toLowerCase() === 'x' ? ' checked' : '') +
              '> ' +
              inline(escapeHtml(task[2])) +
              '</label>';
          } else {
            itemHtml = inline(escapeHtml(content));
          }

          if (indent >= 2) {
            if (!openNested) {
              html += '<' + tag + '>';
              openNested = true;
            }
            html += '<li>' + itemHtml + '</li>';
          } else {
            if (openNested) {
              html += '</' + tag + '>';
              openNested = false;
            }
            html += '<li>' + itemHtml + '</li>';
          }
          i++;
        }
        if (openNested) html += '</' + tag + '>';
        out.push(html + '</' + tag + '>');
        continue;
      }

      // Blank line ends a paragraph
      if (!line.trim()) {
        flushParagraph(para);
        i++;
        continue;
      }

      para.push(line.trim());
      i++;
    }

    flushParagraph(para);

    return { html: out.join('\n'), headings: headings };
  }

  window.MD = { render: render, escapeHtml: escapeHtml, slugify: slugify };
})();
