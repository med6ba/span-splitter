(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const source = $('source');
  const result = $('result');
  const preview = $('preview');
  const sourceStats = $('sourceStats');
  const resultStats = $('resultStats');
  const toastEl = $('toast');
  const codeTab = $('codeTab');
  const previewTab = $('previewTab');
  const codeView = $('codeView');
  const previewView = $('previewView');
  const copyButton = $('copyButton');
  const downloadButton = $('downloadButton');

  // Whitespace-only text between tags stays untouched. These elements hold
  // non-HTML text, sensitive text, or content where inserted spans are unsafe.
  const SKIP_CONTENT = new Set([
    'script', 'style', 'title', 'textarea', 'pre', 'code', 'samp', 'kbd',
    'xmp', 'template', 'noscript', 'iframe', 'noembed', 'noframes',
    'svg', 'math', 'select', 'option', 'plaintext'
  ]);
  const RAW_TEXT = new Set([
    'script', 'style', 'title', 'textarea', 'xmp', 'iframe',
    'noembed', 'noframes', 'plaintext'
  ]);
  const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
  ]);

  // Email/template placeholders are left intact, including {{name}},
  // {% block %}, [[tag]], [url] and %%TRACKING_CODE%%.
  const PLACEHOLDER_RE = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\[\[[\s\S]*?\]\]|%%[A-Za-z_][\w.:-]*%%|\[[A-Za-z_][\w.:-]*\]/g;
  const ENTITY_RE = /(&#(?:[xX][\da-fA-F]+|\d+);|&[A-Za-z][A-Za-z0-9]+;)/g;
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

  const escapeText = (char) => char.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Preserve all original whitespace exactly as typed. Whitespace does not
  // receive span wrappers, including indentation, word spaces and line breaks.
  // This matters for email HTML where extra elements around spaces can change
  // wrapping, and when the source uses white-space: pre / pre-wrap.
  const INVISIBLE_ENTITY = /^&(?:nbsp|NonBreakingSpace|Tab|NewLine|ensp|emsp|emsp13|emsp14|numsp|puncsp|thinsp|hairsp|VeryThinSpace|MediumSpace|ZeroWidthSpace|Negative(?:VeryThin|Thin|Medium|Thick)Space|shy|zwj|zwnj|lrm|rlm|NoBreak);$/i;

  function preserveEntity(entity) {
    if (INVISIBLE_ENTITY.test(entity)) return true;
    const numeric = /^&#(?:([0-9]+)|[xX]([0-9a-fA-F]+));$/.exec(entity);
    if (!numeric) return false;
    const point = parseInt(numeric[1] || numeric[2], numeric[1] ? 10 : 16);
    if (!Number.isFinite(point) || point > 0x10ffff) return false;
    return /[\s\u00ad\u200b-\u200d\u2060\ufeff]/u.test(String.fromCodePoint(point));
  }

  function wrapCharacters(text, stats) {
    if (!text || /^\s*$/.test(text)) return text;
    let transformed = '';
    const chunks = text.split(ENTITY_RE);
    for (const chunk of chunks) {
      if (!chunk) continue;
      if (/^&(?:#(?:[xX][\da-fA-F]+|\d+)|[A-Za-z][A-Za-z0-9]+);$/.test(chunk)) {
        if (preserveEntity(chunk)) {
          transformed += chunk;
        } else {
          transformed += `<span>${chunk}</span>`;
          stats.count++;
        }
        continue;
      }
      const chars = segmenter ? Array.from(segmenter.segment(chunk), item => item.segment) : Array.from(chunk);
      for (const char of chars) {
        // NO wrappers around spaces: a word separator stays ordinary text.
        // Preserve indentation, tabs, newlines and nonbreaking spaces verbatim.
        if (/^\s+$/u.test(char) || /^[\u00ad\u200b-\u200d\u2060\ufeff]+$/u.test(char)) {
          transformed += char;
        } else {
          transformed += `<span>${escapeText(char)}</span>`;
          stats.count++;
        }
      }
    }
    return transformed;
  }

  function convertText(text, stats) {
    if (!text || /^\s*$/.test(text)) return text;
    let output = '';
    let last = 0;
    PLACEHOLDER_RE.lastIndex = 0;
    for (const match of text.matchAll(PLACEHOLDER_RE)) {
      output += wrapCharacters(text.slice(last, match.index), stats);
      output += match[0];
      last = match.index + match[0].length;
    }
    return output + wrapCharacters(text.slice(last), stats);
  }

  function findTagEnd(html, start) {
    let quote = null;
    for (let i = start + 1; i < html.length; i++) {
      const c = html[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        return i + 1;
      }
    }
    return -1;
  }

  function findRawClose(lower, tag, from) {
    const needle = `</${tag}`;
    let at = lower.indexOf(needle, from);
    while (at !== -1) {
      const boundary = lower[at + needle.length];
      if (boundary === undefined || /[\s>]/.test(boundary)) return at;
      at = lower.indexOf(needle, at + needle.length);
    }
    return -1;
  }

  function splitHtml(html) {
    const stats = { count: 0 };
    const output = [];
    const lower = html.toLowerCase();
    const ignored = [];
    let raw = null;
    let i = 0;

    while (i < html.length) {
      if (raw) {
        if (raw === 'plaintext') {
          output.push(html.slice(i));
          break;
        }
        const closeAt = findRawClose(lower, raw, i);
        if (closeAt === -1) {
          output.push(html.slice(i));
          break;
        }
        output.push(html.slice(i, closeAt));
        i = closeAt;
        raw = null;
      }

      if (i >= html.length) break;
      if (html[i] !== '<') {
        const next = html.indexOf('<', i);
        const end = next === -1 ? html.length : next;
        const text = html.slice(i, end);
        output.push(ignored.length ? text : convertText(text, stats));
        i = end;
        continue;
      }

      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i + 4);
        const to = end === -1 ? html.length : end + 3;
        output.push(html.slice(i, to));
        i = to;
        continue;
      }
      if (html.startsWith('<![CDATA[', i)) {
        const end = html.indexOf(']]>', i + 9);
        const to = end === -1 ? html.length : end + 3;
        output.push(html.slice(i, to));
        i = to;
        continue;
      }
      if (/^<!|^<\?/.test(html.slice(i, i + 3))) {
        const end = findTagEnd(html, i);
        if (end !== -1) {
          output.push(html.slice(i, end));
          i = end;
          continue;
        }
      }

      const tagMatch = /^<\s*(\/?)\s*([A-Za-z][\w:.-]*)(?=[\s/>])/.exec(html.slice(i, i + 100));
      if (tagMatch) {
        const end = findTagEnd(html, i);
        if (end !== -1) {
          const token = html.slice(i, end);
          const tag = tagMatch[2].toLowerCase();
          const isClosing = tagMatch[1] === '/';
          const isSelfClosing = /\/\s*>$/.test(token) || VOID_ELEMENTS.has(tag);
          if (isClosing) {
            const index = ignored.lastIndexOf(tag);
            if (index !== -1) ignored.splice(index);
          } else if (!isSelfClosing && SKIP_CONTENT.has(tag)) {
            ignored.push(tag);
            if (RAW_TEXT.has(tag)) raw = tag;
          }
          output.push(token);
          i = end;
          continue;
        }
      }

      // A literal '<' in a text node should not be treated as HTML markup.
      output.push(ignored.length ? '<' : '<span>&lt;</span>');
      if (!ignored.length) stats.count++;
      i++;
    }

    return { html: output.join(''), count: stats.count };
  }

  let renderTimer = null;
  let latestHtml = '';
  let activeView = 'code';
  let toastTimer = null;

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 1900);
  }

  function updatePreview() {
    // Sandboxed iframe blocks JS and form submission in imported markup.
    // srcdoc keeps the preview fully local, except referenced remote assets.
    preview.srcdoc = latestHtml || '<!doctype html><html><body></body></html>';
  }

  function render() {
    clearTimeout(renderTimer);
    const text = source.value;
    sourceStats.textContent = `${text.length.toLocaleString()} characters`;
    const converted = splitHtml(text);
    latestHtml = converted.html;
    result.value = latestHtml;
    resultStats.textContent = `${converted.count.toLocaleString()} spans`;
    const available = latestHtml.length > 0;
    copyButton.disabled = !available;
    downloadButton.disabled = !available;
    if (activeView === 'preview') updatePreview();
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    sourceStats.textContent = `${source.value.length.toLocaleString()} characters`;
    renderTimer = setTimeout(render, 140);
  }

  function setView(view) {
    activeView = view;
    const showCode = view === 'code';
    codeView.hidden = !showCode;
    previewView.hidden = showCode;
    codeTab.classList.toggle('active', showCode);
    previewTab.classList.toggle('active', !showCode);
    codeTab.setAttribute('aria-pressed', String(showCode));
    previewTab.setAttribute('aria-pressed', String(!showCode));
    if (!showCode) updatePreview();
  }

  async function copyHtml() {
    render();
    if (!latestHtml) return;
    try {
      await navigator.clipboard.writeText(latestHtml);
    } catch (_) {
      // Clipboard API can be unavailable in some file:// browser contexts.
      result.focus();
      result.select();
      const succeeded = document.execCommand('copy');
      if (!succeeded) {
        showToast('Select the output and copy it manually');
        return;
      }
    }
    showToast('HTML copied');
  }

  function downloadHtml() {
    render();
    if (!latestHtml) return;
    const blob = new Blob([latestHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'medba-converted.html';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast('HTML downloaded');
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('themeButton').setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    try { localStorage.setItem('medba-span-theme', theme); } catch (_) { /* optional */ }
  }

  $('themeButton').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  $('importButton').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    source.value = await file.text();
    render();
    event.target.value = '';
    showToast('File imported');
  });
  $('clearButton').addEventListener('click', () => {
    source.value = '';
    render();
    source.focus();
  });
  source.addEventListener('input', scheduleRender);
  source.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const from = source.selectionStart;
      const to = source.selectionEnd;
      source.setRangeText('  ', from, to, 'end');
      scheduleRender();
    }
  });
  codeTab.addEventListener('click', () => setView('code'));
  previewTab.addEventListener('click', () => setView('preview'));
  copyButton.addEventListener('click', copyHtml);
  downloadButton.addEventListener('click', downloadHtml);

  try { applyTheme(localStorage.getItem('medba-span-theme') === 'dark' ? 'dark' : 'light'); }
  catch (_) { applyTheme('light'); }
  render();
})();
