import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import type Token from 'markdown-it/lib/token.mjs';
import hljs from 'highlight.js';

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

let mdInstance: MarkdownIt | null = null;

function getMd(): MarkdownIt {
  if (!mdInstance) {
    mdInstance = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      highlight: (str, lang) => {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(str, { language: lang }).value;
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
  }
  return mdInstance;
}

export function renderMarkdown(source: string): string {
  const md = getMd();
  let html = md.render(source);
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
