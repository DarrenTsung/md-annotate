import MarkdownIt from 'markdown-it';
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

    // Open all links in a new tab
    const defaultRender = mdInstance.renderer.rules.link_open ||
      function (tokens, idx, options, _env, self) {
        return self.renderToken(tokens, idx, options);
      };

    mdInstance.renderer.rules.link_open = function (tokens, idx, options, env, self) {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
      return defaultRender(tokens, idx, options, env, self);
    };
  }
  return mdInstance;
}

export function renderMarkdown(source: string): string {
  const md = getMd();
  return md.render(source);
}
