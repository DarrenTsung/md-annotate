import fs from 'node:fs';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import type Token from 'markdown-it/lib/token.mjs';
import hljs from 'highlight.js';

/**
 * Normalize CRLF / lone-CR line endings to LF.
 *
 * markdown-it normalizes line endings internally before computing token
 * source maps, so the source offsets we emit are relative to an LF string.
 * The raw markdown the client uses for selection→offset mapping (and the
 * content the server slices for edits) must be the SAME LF-normalized string,
 * or every stripped `\r` shifts the offsets and selections land off-target.
 * Normalizing on read keeps all three in sync.
 */
export function normalizeLineEndings(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

/** Read a markdown file from disk with line endings normalized to LF. */
export function readMarkdownFileSync(filePath: string): string {
  return normalizeLineEndings(fs.readFileSync(filePath, 'utf-8'));
}

// Custom markdown-it plugin that adds data-source-offset attributes to block elements
function sourceOffsetPlugin(md: MarkdownIt) {
  // Patch the core rule to inject source offset info into tokens
  md.core.ruler.push('source_offset', (state) => {
    const src = state.src;
    const lines = src.split('\n');

    // Build a line-start-offset lookup
    const lineOffsets: number[] = [0];
    for (let i = 0; i < lines.length; i++) {
      lineOffsets.push(lineOffsets[i] + lines[i].length + 1);
    }

    function walk(tokens: Token[]) {
      for (const token of tokens) {
        if (token.map && token.map.length === 2) {
          const startLine = token.map[0];
          const endLine = token.map[1];
          const startOffset = lineOffsets[startLine] ?? 0;
          const endOffset = lineOffsets[endLine] ?? src.length;

          token.attrSet('data-source-start', String(startOffset));
          token.attrSet('data-source-end', String(endOffset));
        }
        if (token.children) {
          walk(token.children);
        }
      }
    }

    walk(state.tokens);
  });

}

// hljs's grammars (notably Go) don't tag function-call identifiers, so they
// render as bare text. Wrap any IDENT immediately followed by `(` (excluding
// language keywords / built-ins) so the syntax theme can color them.
const FN_NAME_RE = /(>|^|[\s.,;:(){}[\]&|*=+\-/<!])([A-Za-z_$][A-Za-z0-9_$]*)(\s*\()/g;
const FN_DENYLIST = new Set([
  'if', 'for', 'while', 'switch', 'case', 'default', 'return', 'break',
  'continue', 'go', 'defer', 'select', 'range', 'func', 'fn', 'function',
  'def', 'class', 'struct', 'interface', 'type', 'package', 'import',
  'const', 'let', 'var', 'static', 'public', 'private', 'protected',
  'do', 'else', 'try', 'catch', 'finally', 'throw', 'with', 'await',
  'async', 'yield', 'new', 'delete', 'typeof', 'instanceof', 'in', 'of',
  'and', 'or', 'not', 'is', 'as', 'lambda', 'pass', 'true', 'false', 'nil',
  'null', 'undefined', 'self', 'super', 'this', 'sizeof', 'use', 'mut',
  'pub', 'impl', 'where', 'unsafe', 'move',
]);

function wrapFunctionCalls(html: string): string {
  return html.replace(FN_NAME_RE, (full, prefix, name, post) => {
    if (FN_DENYLIST.has(name)) return full;
    return `${prefix}<span class="hljs-title function_">${name}</span>${post}`;
  });
}

let mdInstance: MarkdownIt | null = null;

function getMd(): MarkdownIt {
  if (!mdInstance) {
    mdInstance = new MarkdownIt({
      html: true,
      breaks: false,
      linkify: true,
      typographer: true,
      highlight: (str, lang) => {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return wrapFunctionCalls(hljs.highlight(str, { language: lang }).value);
          } catch {
            // fall through
          }
        }
        return ''; // use external default escaping
      },
    });
    mdInstance.use(sourceOffsetPlugin);
    mdInstance.use(taskLists, { enabled: false });

    // Add id slugs to headings for anchor links
    const defaultHeadingOpen = mdInstance.renderer.rules.heading_open ||
      function (tokens, idx, options, _env, self) {
        return self.renderToken(tokens, idx, options);
      };

    mdInstance.renderer.rules.heading_open = function (tokens, idx, options, env, self) {
      // The next token is the inline content of the heading
      const contentToken = tokens[idx + 1];
      if (contentToken?.children) {
        const text = contentToken.children
          .filter((t) => t.type === 'text' || t.type === 'code_inline')
          .map((t) => t.content)
          .join('');
        const slug = text
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        if (slug) {
          tokens[idx].attrSet('id', slug);
        }
      }
      return defaultHeadingOpen(tokens, idx, options, env, self);
    };

    // External links open in new tab; anchor links are left alone
    const defaultLinkOpen = mdInstance.renderer.rules.link_open ||
      function (tokens, idx, options, _env, self) {
        return self.renderToken(tokens, idx, options);
      };

    mdInstance.renderer.rules.link_open = function (tokens, idx, options, env, self) {
      const href = tokens[idx].attrGet('href') || '';
      const isAnchor = href.startsWith('#');
      const isRelativeMd = !isAnchor && !/^[a-z]+:/i.test(href) && href.replace(/#.*$/, '').endsWith('.md');
      if (!isAnchor && !isRelativeMd) {
        tokens[idx].attrSet('target', '_blank');
        tokens[idx].attrSet('rel', 'noopener noreferrer');
      }
      return defaultLinkOpen(tokens, idx, options, env, self);
    };

    // Embedded HTML widgets: a doc may carry self-contained interactive HTML
    // (shared <style> + mount <div>s + shared <script>). We render each mount
    // block into a sandboxed iframe (so its CSS/JS is isolated and scripts run)
    // and suppress the bare <style>/<script> asset blocks from the page flow —
    // they're bundled into every widget's iframe instead. See classifyEmbeds().
    const defaultHtmlBlock = mdInstance.renderer.rules.html_block ||
      function (tokens, idx) {
        return tokens[idx].content;
      };

    mdInstance.renderer.rules.html_block = function (tokens, idx, options, env, self) {
      const token = tokens[idx];
      const kind = (token.meta as { embedKind?: string } | undefined)?.embedKind;
      if (kind === 'asset') return '';
      if (kind === 'widget') {
        const e = env as EmbedEnv;
        const start = token.attrGet('data-source-start') || '';
        const end = token.attrGet('data-source-end') || '';
        const srcdoc = buildEmbedSrcdoc(e.embedStyles || [], e.embedScripts || [], token.content);
        const b64 = Buffer.from(srcdoc, 'utf-8').toString('base64');
        return (
          `<div class="html-embed" data-embed-srcdoc="${b64}"` +
          ` data-source-start="${start}" data-source-end="${end}"></div>\n`
        );
      }
      return defaultHtmlBlock(tokens, idx, options, env, self);
    };
  }
  return mdInstance;
}

interface EmbedEnv {
  embedStyles?: string[];
  embedScripts?: string[];
}

/** Block-level tags treated as embeddable interactive widgets (vs. inline HTML). */
const WIDGET_TAG_RE = /^<(div|section|figure|svg|canvas|form|aside|main|article)[\s>]/i;

/**
 * Walk the token stream and classify raw HTML blocks:
 *  - `<style>` / `<script>` blocks become shared `asset`s, collected on `env`
 *    and bundled into each widget iframe (and suppressed from the page flow).
 *  - Container blocks (div/section/…) in a doc that has any embedded
 *    style/script become `widget`s rendered as isolated iframes.
 *  - Everything else falls through to the default passthrough rendering.
 */
function classifyEmbeds(tokens: Token[], env: EmbedEnv): void {
  const styles: string[] = [];
  const scripts: string[] = [];
  const candidates: Token[] = [];

  function walk(list: Token[]) {
    for (const token of list) {
      if (token.type === 'html_block') {
        const c = token.content.trim();
        if (/^<style[\s>]/i.test(c)) {
          styles.push(token.content);
          token.meta = { ...(token.meta as object), embedKind: 'asset' };
        } else if (/^<script[\s>]/i.test(c)) {
          scripts.push(token.content);
          token.meta = { ...(token.meta as object), embedKind: 'asset' };
        } else if (WIDGET_TAG_RE.test(c)) {
          candidates.push(token);
        }
      }
      if (token.children) walk(token.children);
    }
  }
  walk(tokens);

  env.embedStyles = styles;
  env.embedScripts = scripts;

  // Only treat container blocks as iframe widgets when the document actually
  // carries embedded behavior — otherwise plain HTML stays inline (and
  // annotatable) as before.
  const rich = styles.length > 0 || scripts.length > 0;
  for (const token of candidates) {
    token.meta = { ...(token.meta as object), embedKind: rich ? 'widget' : 'inline' };
  }
}

/** Build a self-contained HTML document for a widget iframe's `srcdoc`. */
function buildEmbedSrcdoc(styles: string[], scripts: string[], body: string): string {
  const base =
    '<style>html,body{margin:0;padding:0;background:transparent;color:#1f2328;' +
    'font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}' +
    '*{box-sizing:border-box}' +
    // Collapse the widget's own outer vertical margins so the iframe hugs its
    // visible content (the .html-embed wrapper already spaces it from prose).
    'body>*:first-child{margin-top:0}body>*:last-child{margin-bottom:0}</style>';
  // Report content height to the parent so the iframe can size to fit.
  const resize =
    '<script>(function(){function s(){try{parent.postMessage({__htmlEmbed:1,' +
    'name:window.name,height:document.documentElement.scrollHeight},"*")}catch(e){}}' +
    'if(window.ResizeObserver){new ResizeObserver(s).observe(document.documentElement)}' +
    'window.addEventListener("load",s);[60,300,1000].forEach(function(t){setTimeout(s,t)})})();</script>';
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    base +
    styles.join('\n') +
    '</head><body>' +
    body +
    scripts.join('\n') +
    resize +
    '</body></html>'
  );
}

export function renderMarkdown(source: string): string {
  const md = getMd();
  const env: EmbedEnv = {};
  const tokens = md.parse(source, env);
  classifyEmbeds(tokens, env);
  let html = md.renderer.render(tokens, md.options, env);
  // Replace <!-- @actions: ... --> comments with action buttons.
  // With html: true, markdown-it passes HTML comments through verbatim.
  html = html.replace(
    /<!--\s*@actions:\s*(.+?)\s*-->/g,
    (_match, actionList: string) => {
      const actions = actionList.split(',').map((a) => a.trim()).filter(Boolean);
      const buttons = actions
        .map((name) => {
          // Strip surrounding quotes if present (e.g. "check types")
          const clean = name.replace(/^["']|["']$/g, '');
          return `<button class="action-btn" data-action="${escapeAttr(clean)}">${escapeHtml(clean)}</button>`;
        })
        .join('');
      return `<span class="action-buttons">${buttons}</span>`;
    }
  );
  return html;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
