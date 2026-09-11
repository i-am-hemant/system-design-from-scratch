/* app.js — shared behaviour. No dependencies, no build step.
   Owns: theme persistence, keyboard shortcuts. */

(function () {
  'use strict';

  var THEME_KEY = 'sdfs:theme';
  var root = document.documentElement;

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      /* private mode — theme just won't persist */
    }
  }

  function initial() {
    try {
      var stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (e) {
      /* ignore */
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  apply(initial());

  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
      });
    }

    // Mark the current page in the nav without hardcoding it per file.
    var here = window.location.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    Array.prototype.forEach.call(document.querySelectorAll('.site-nav a'), function (a) {
      var href = a.getAttribute('href');
      if (!href || href.indexOf('http') === 0) return;
      var target = href.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
      if (target === here) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    // "/" focuses catalog search when present.
    if (e.key === '/') {
      var search = document.getElementById('search');
      if (search) {
        e.preventDefault();
        search.focus();
      }
    }
  });
})();
