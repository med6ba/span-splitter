(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const source = $('source');
  const result = $('result');
  const preview = $('preview');
  const codeView = $('codeView');
  const previewView = $('previewView');
  const settingsPanel = $('settingsPanel');
  const settingsOverlay = $('settingsOverlay');
  const htmlError = $('htmlError');
  const htmlErrorDetail = $('htmlErrorDetail');
  const previewInvalid = $('previewInvalid');
  const settingsBtn = $('settingsBtn');
  const wordWrap = $('wordWrap');
  const autoProtectTags = $('autoProtectTags');
  const darkMode = $('darkMode');
  const resizer = $('resizer');
  const workspace = $('workspace');
  const toast = $('toast');

  const STORE = {
    theme: 'span-splitter.theme',
    wrap: 'span-splitter.wrap',
    autoProtectTags: 'span-splitter.auto-protect-tags',
    split: 'span-splitter.split',
    splitMobile: 'span-splitter.splitMobile'
  };
  const remember = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} };
  const recall = (key) => { try { return localStorage.getItem(key); } catch (_) { return null; } };

  // Preserve HTML markup/attributes and formatting whitespace. Only non-whitespace
  // text is split, except optional bracket-style tags.
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
  const ENTITY_RE = /(&#(?:[xX][\da-fA-F]+|\d+);|&[A-Za-z][A-Za-z0-9]+;)/g;
  const BRACKET_TAG_RE = /\[[A-Za-z0-9_][A-Za-z0-9_.:|\/-]*\]/g;
  const INVISIBLE_ENTITY = /^&(?:nbsp|NonBreakingSpace|Tab|NewLine|ensp|emsp|emsp13|emsp14|numsp|puncsp|thinsp|hairsp|VeryThinSpace|MediumSpace|ZeroWidthSpace|Negative(?:VeryThin|Thin|Medium|Thick)Space|shy|zwj|zwnj|lrm|rlm|NoBreak);$/i;
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

  function preserveEntity(entity) {
    if (INVISIBLE_ENTITY.test(entity)) return true;
    const numeric = /^&#(?:([0-9]+)|[xX]([0-9a-fA-F]+));$/.exec(entity);
    if (!numeric) return false;
    const codepoint = parseInt(numeric[1] || numeric[2], numeric[1] ? 10 : 16);
    if (!Number.isFinite(codepoint) || codepoint > 0x10ffff) return false;
    return /[\s\u00ad\u200b-\u200d\u2060\ufeff]/u.test(String.fromCodePoint(codepoint));
  }

  function escapeText(character) {
    return character.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function wrapCharacters(text) {
    if (!text || /^\s*$/u.test(text)) return text;
    let transformed = '';
    for (const chunk of text.split(ENTITY_RE)) {
      if (!chunk) continue;
      if (/^&(?:#(?:[xX][\da-fA-F]+|\d+)|[A-Za-z][A-Za-z0-9]+);$/.test(chunk)) {
        transformed += preserveEntity(chunk) ? chunk : `<span>${chunk}</span>`;
        continue;
      }
      const characters = segmenter
        ? Array.from(segmenter.segment(chunk), item => item.segment) : Array.from(chunk);
      for (const character of characters) {
        transformed += /^\s+$/u.test(character) || /^[\u00ad\u200b-\u200d\u2060\ufeff]+$/u.test(character)
          ? character : `<span>${escapeText(character)}</span>`;
      }
    }
    return transformed;
  }


  // Preserve bracket-style placeholders in text nodes only when the setting is on.
  // Markup and attributes are never modified by the splitter.
  function getProtectedRanges(html, protectBracketTags) {
    if (!protectBracketTags) return [];
    return Array.from(html.matchAll(BRACKET_TAG_RE), match =>
      [match.index, match.index + match[0].length]
    );
  }

  function convertTextWithProtectedRanges(text, start, ranges) {
    if (!text || /^\s*$/u.test(text) || !ranges.length) return wrapCharacters(text);
    const end = start + text.length;
    let index = 0;
    let output = '';
    // Binary search for the first protected interval touching this text node.
    let lo = 0, hi = ranges.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ranges[mid][1] <= start) lo = mid + 1;
      else hi = mid;
    }
    for (let n = lo; n < ranges.length && ranges[n][0] < end; n++) {
      const [rangeStart, rangeEnd] = ranges[n];
      const from = Math.max(start, rangeStart) - start;
      const to = Math.min(end, rangeEnd) - start;
      if (from > index) output += wrapCharacters(text.slice(index, from));
      output += text.slice(Math.max(index, from), to);
      index = Math.max(index, to);
    }
    return output + wrapCharacters(text.slice(index));
  }

  function findTagEnd(html, start) {
    let quote = null;
    for (let i = start + 1; i < html.length; i++) {
      const c = html[i];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') return i + 1;
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

  function isProtectedAt(position, ranges) {
    let lo = 0, hi = ranges.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ranges[mid][1] <= position) lo = mid + 1;
      else hi = mid;
    }
    return lo < ranges.length && ranges[lo][0] <= position;
  }

  function splitHtml(html, protectBracketTags = true) {
    const output = [];
    const lower = html.toLowerCase();
    const protectedRanges = getProtectedRanges(html, protectBracketTags);
    const ignored = [];
    let raw = null;
    let i = 0;

    while (i < html.length) {
      if (raw) {
        if (raw === 'plaintext') { output.push(html.slice(i)); break; }
        const closeAt = findRawClose(lower, raw, i);
        if (closeAt === -1) { output.push(html.slice(i)); break; }
        output.push(html.slice(i, closeAt));
        i = closeAt;
        raw = null;
      }
      if (i >= html.length) break;

      if (html[i] !== '<') {
        const next = html.indexOf('<', i);
        const end = next === -1 ? html.length : next;
        const text = html.slice(i, end);
        output.push(ignored.length ? text : convertTextWithProtectedRanges(text, i, protectedRanges));
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
        if (end !== -1) { output.push(html.slice(i, end)); i = end; continue; }
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
      // Literal '<' in a text node: keep it if locked, otherwise encode it.
      output.push(ignored.length || isProtectedAt(i, protectedRanges) ? '<' : '<span>&lt;</span>');
      i++;
    }
    return output.join('');
  }

  // Lightweight structural validator. Browsers repair broken HTML silently,
  // so check likely markup mistakes before showing the preview. This is not a
  // full HTML5 validator and deliberately permits optional closing tags.
  const OPTIONAL_CLOSE = new Set([
    'html', 'head', 'body', 'p', 'li', 'dt', 'dd', 'option', 'optgroup',
    'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'rb', 'rt', 'rp'
  ]);
  const AUTO_CLOSE_ON_OPEN = {
    li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'],
    p: ['p'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'],
    option: ['option'], optgroup: ['option', 'optgroup'],
    thead: ['thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
    tbody: ['thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
    tfoot: ['thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
    body: ['head']
  };
  function validateHtml(html) {
    const stack = [];
    const lower = html.toLowerCase();
    const problem = (message, pos) => ({
      message: `Line ${html.slice(0, pos).split('\n').length}: ${message}`,
      position: pos
    });
    let i = 0;
    while (i < html.length) {
      const at = html.indexOf('<', i);
      if (at < 0) break;
      i = at;
      if (html.startsWith('<!--', i)) {
        const close = html.indexOf('-->', i + 4);
        if (close < 0) return problem('Unclosed HTML comment.', i);
        i = close + 3;
        continue;
      }
      if (html.startsWith('<![CDATA[', i)) {
        const close = html.indexOf(']]>', i + 9);
        if (close < 0) return problem('Unclosed CDATA section.', i);
        i = close + 3;
        continue;
      }
      if (/^<!|^<\?/.test(html.slice(i, i + 3))) {
        const end = findTagEnd(html, i);
        if (end < 0) return problem('Declaration is missing its closing >.', i);
        i = end;
        continue;
      }
      const match = /^<\s*(\/?)\s*([A-Za-z][\w:.-]*)(?=[\s/>])/.exec(html.slice(i, i + 150));
      if (!match) { i++; continue; } // A literal less-than sign in text.
      const end = findTagEnd(html, i);
      if (end < 0) return problem(`Tag <${match[2]}> is missing > or has an unclosed quote.`, i);
      const tag = match[2].toLowerCase();
      const closing = !!match[1];
      const selfClosing = /\/\s*>$/.test(html.slice(i, end)) || VOID_ELEMENTS.has(tag);
      if (closing) {
        const found = stack.findLastIndex(entry => entry.tag === tag);
        if (found < 0) {
          if (!OPTIONAL_CLOSE.has(tag)) return problem(`Unexpected closing tag </${tag}>.`, i);
        } else {
          for (let k = stack.length - 1; k > found; k--) {
            if (!OPTIONAL_CLOSE.has(stack[k].tag)) {
              return problem(`Unclosed <${stack[k].tag}> before </${tag}>.`, stack[k].position);
            }
          }
          stack.length = found;
        }
      } else if (!selfClosing) {
        const autoClose = AUTO_CLOSE_ON_OPEN[tag];
        if (autoClose) {
          while (stack.length && autoClose.includes(stack[stack.length - 1].tag)) stack.pop();
        }
        // Block-level content implicitly closes an open paragraph.
        if (/^(?:div|section|article|header|footer|table|ul|ol|h[1-6]|blockquote|pre|address)$/i.test(tag)) {
          while (stack.length && stack[stack.length - 1].tag === 'p') stack.pop();
        }
        stack.push({tag, position: i});
        if (RAW_TEXT.has(tag)) {
          if (tag === 'plaintext') { i = html.length; break; }
          const closeAt = findRawClose(lower, tag, end);
          if (closeAt < 0) return problem(`Unclosed <${tag}> element.`, i);
          i = closeAt;
          continue;
        }
      }
      i = end;
    }
    const unclosed = stack.find(entry => !OPTIONAL_CLOSE.has(entry.tag));
    return unclosed ? problem(`Unclosed <${unclosed.tag}> element.`, unclosed.position) : null;
  }

  let outputHtml = '';
  let view = 'code';
  let currentError = null;
  let lastPreviewDoc = null;
  let previewFrame = 0;
  let toastTimer = null;
  const BLANK_PREVIEW = '<!doctype html><html><body></body></html>';

  function flash(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 1600);
  }
  function refreshPreview() {
    previewFrame = 0;
    const nextDocument = currentError ? BLANK_PREVIEW : (outputHtml || BLANK_PREVIEW);
    if (lastPreviewDoc !== nextDocument) {
      lastPreviewDoc = nextDocument;
      preview.srcdoc = nextDocument;
    }
  }
  function schedulePreview() {
    if (previewFrame) cancelAnimationFrame(previewFrame);
    previewFrame = requestAnimationFrame(refreshPreview);
  }
  function render() {
    const html = source.value;
    currentError = validateHtml(html);
    outputHtml = splitHtml(html, autoProtectTags.checked);
    result.value = outputHtml;
    htmlError.hidden = !currentError;
    htmlErrorDetail.textContent = currentError ? currentError.message : '';
    previewInvalid.hidden = !currentError;
    $('copyInputBtn').disabled = !html;
    $('copyBtn').disabled = !outputHtml || !!currentError;
    $('downloadBtn').disabled = !outputHtml || !!currentError;
    // Keep the iframe up-to-date even in Code view. Switching to Preview now
    // reveals the current document without scheduling a second, stale reload.
    schedulePreview();
  }
  function setView(next) {
    view = next;
    codeView.hidden = next !== 'code';
    previewView.hidden = next !== 'preview';
    for (const [button, selected] of [[$('codeBtn'), next === 'code'], [$('previewBtn'), next === 'preview']]) {
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    if (next === 'preview') {
      if (previewFrame) cancelAnimationFrame(previewFrame);
      refreshPreview();
    }
  }
  function setWrap(enabled) {
    wordWrap.checked = enabled;
    document.body.classList.toggle('wrap-on', enabled);
    source.wrap = enabled ? 'soft' : 'off';
    result.wrap = enabled ? 'soft' : 'off';
    source.style.overflowX = enabled ? 'hidden' : 'auto';
    result.style.overflowX = enabled ? 'hidden' : 'auto';
    remember(STORE.wrap, String(enabled));
  }
  function setAutoProtectTags(enabled) {
    autoProtectTags.checked = enabled;
    remember(STORE.autoProtectTags, String(enabled));
    render();
  }
  function setTheme(dark) {
    darkMode.checked = dark;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#121a29' : '#ffffff';
    remember(STORE.theme, dark ? 'dark' : 'light');
  }
  function showSettings(open) {
    settingsOverlay.hidden = !open;
    settingsBtn.setAttribute('aria-expanded', String(open));
    settingsBtn.classList.toggle('selected', open);
    if (open) $('closeSettings').focus();
  }

  function getMobile() { return matchMedia('(max-width: 760px)').matches; }
  function setSplit(value, mobile = getMobile()) {
    const percent = Math.max(20, Math.min(80, Number(value) || 50));
    document.documentElement.style.setProperty(mobile ? '--split-mobile' : '--split', `${percent}%`);
    remember(mobile ? STORE.splitMobile : STORE.split, String(percent));
    resizer.setAttribute('aria-orientation', mobile ? 'horizontal' : 'vertical');
    resizer.setAttribute('aria-valuenow', String(Math.round(percent)));
  }
  function splitFromPoint(event) {
    const rect = workspace.getBoundingClientRect();
    const mobile = getMobile();
    const coordinate = mobile ? event.clientY - rect.top : event.clientX - rect.left;
    const total = mobile ? rect.height : rect.width;
    setSplit((coordinate / total) * 100, mobile);
  }

  $('importBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { source.value = await file.text(); render(); flash('HTML imported'); }
    catch (_) { flash('Could not read file'); }
    event.target.value = '';
  });
  $('clearBtn').addEventListener('click', () => { source.value = ''; render(); source.focus(); });
  source.addEventListener('input', render);
  source.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      source.setRangeText('  ', source.selectionStart, source.selectionEnd, 'end');
      render();
    }
  });
  $('codeBtn').addEventListener('click', () => setView('code'));
  $('previewBtn').addEventListener('click', () => setView('preview'));
  async function copyText(text, label) {
    if (!text) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // The Clipboard API can be blocked on file:// pages.
      const temp = document.createElement('textarea');
      temp.value = text;
      temp.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.append(temp);
      temp.focus(); temp.select();
      const copied = document.execCommand('copy');
      temp.remove();
      if (!copied) { flash('Copy unavailable'); return; }
    }
    flash(label);
  }
  $('copyInputBtn').addEventListener('click', () => copyText(source.value, 'Input copied'));
  $('copyBtn').addEventListener('click', () => {
    if (currentError) { flash('Check your HTML first'); return; }
    copyText(outputHtml, 'Output copied');
  });
  $('downloadBtn').addEventListener('click', () => {
    if (!outputHtml || currentError) return;
    const url = URL.createObjectURL(new Blob([outputHtml], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'converted.html';
    document.body.append(link);
    link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    flash('HTML downloaded');
  });
  settingsBtn.addEventListener('click', () => showSettings(settingsOverlay.hidden));
  $('closeSettings').addEventListener('click', () => { showSettings(false); settingsBtn.focus(); });
  settingsOverlay.addEventListener('pointerdown', event => {
    if (event.target === settingsOverlay) showSettings(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !settingsOverlay.hidden) { showSettings(false); settingsBtn.focus(); }
    if (event.key === 'Tab' && !settingsOverlay.hidden) {
      const focusable = Array.from(settingsPanel.querySelectorAll('button,input:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  wordWrap.addEventListener('change', () => setWrap(wordWrap.checked));
  autoProtectTags.addEventListener('change', () => setAutoProtectTags(autoProtectTags.checked));
  darkMode.addEventListener('change', () => setTheme(darkMode.checked));

  let dragging = false;
  resizer.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    resizer.classList.add('dragging');
    document.body.classList.add('resizing');
    splitFromPoint(event);
  });
  document.addEventListener('pointermove', event => {
    if (dragging) splitFromPoint(event);
  });
  function stopDragging() {
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.classList.remove('resizing');
  }
  document.addEventListener('pointerup', stopDragging);
  document.addEventListener('pointercancel', stopDragging);
  window.addEventListener('blur', stopDragging);
  resizer.addEventListener('dblclick', () => setSplit(50));
  resizer.addEventListener('keydown', event => {
    const mobile = getMobile();
    const current = Number(recall(mobile ? STORE.splitMobile : STORE.split) || 50);
    const step = event.shiftKey ? 10 : 3;
    const direction = mobile
      ? (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)
      : (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0);
    if (direction || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setSplit(event.key === 'Home' ? 20 : event.key === 'End' ? 80 : current + direction * step);
    }
  });
  const breakpoint = matchMedia('(max-width: 760px)');
  const adjustOrientation = () => {
    resizer.setAttribute('aria-orientation', getMobile() ? 'horizontal' : 'vertical');
    resizer.setAttribute('aria-valuenow', String(Math.round(Number(recall(getMobile() ? STORE.splitMobile : STORE.split) || 50))));
  };
  breakpoint.addEventListener?.('change', adjustOrientation);

  // Local settings are optional: the app is fully functional even when
  // localStorage is unavailable, such as in restricted file:// contexts.
  setWrap(recall(STORE.wrap) !== 'false');
  setAutoProtectTags(recall(STORE.autoProtectTags) !== 'false');
  setTheme(recall(STORE.theme) === 'dark');
  setSplit(Number(recall(STORE.split) || 50), false);
  setSplit(Number(recall(STORE.splitMobile) || 50), true);
  adjustOrientation();
  render();
})();
