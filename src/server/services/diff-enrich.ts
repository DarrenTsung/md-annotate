import { diffWords } from 'diff';
import type { DiffHunk } from '../../shared/types.js';
import { renderMarkdown } from './markdown.js';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Enrich hunks for the client overlay:
 * - Removed hunks get rendered HTML
 * - Adjacent removed+added pairs that are similar get merged into 'modified'
 *   hunks with inline <del>/<ins> word-level diffs
 */
export function enrichHunks(hunks: DiffHunk[]): DiffHunk[] {
  const result: DiffHunk[] = [];
  let i = 0;

  while (i < hunks.length) {
    // Look for adjacent removed + added pairs at the same position
    if (i + 1 < hunks.length
        && hunks[i].type === 'removed'
        && hunks[i + 1].type === 'added'
        && hunks[i].newOffset === hunks[i + 1].newOffset) {

      const removed = hunks[i];
      const added = hunks[i + 1];

      // Compute word-level diff and similarity
      const parts = diffWords(removed.value, added.value);
      const unchangedLen = parts
        .filter((p) => !p.added && !p.removed)
        .reduce((sum, p) => sum + p.value.length, 0);
      const totalLen = Math.max(removed.value.length, added.value.length);
      const similarity = totalLen > 0 ? unchangedLen / totalLen : 0;

      // Don't merge into inline diff when the line count changes
      // drastically (e.g., 1 bullet expanded into 8 subtasks). The
      // inline diff rendering breaks for these structural changes.
      const removedLines = removed.value.split('\n').length;
      const addedLines = added.value.split('\n').length;
      const lineRatio = Math.max(removedLines, addedLines) / Math.max(1, Math.min(removedLines, addedLines));

      if (similarity >= 0.4 && lineRatio <= 3) {
        // Similar enough: build inline diff markdown, then render.
        // <del>/<ins> tags pass through markdown-it with html: true.
        let combined = '';
        for (const part of parts) {
          if (part.removed) {
            combined += `<del>${escHtml(part.value)}</del>`;
          } else if (part.added) {
            combined += `<ins>${escHtml(part.value)}</ins>`;
          } else {
            combined += part.value; // raw markdown, rendered by markdown-it
          }
        }

        result.push({
          type: 'modified',
          value: added.value,
          renderedValue: renderMarkdown(combined),
          newOffset: added.newOffset,
          oldOffset: removed.oldOffset,
        });
        i += 2;
        continue;
      }
    }

    // Not a merge candidate
    const h = hunks[i];
    if (h.type === 'removed') {
      result.push({ ...h, renderedValue: renderMarkdown(h.value) });
    } else {
      result.push(h);
    }
    i++;
  }

  return result;
}
