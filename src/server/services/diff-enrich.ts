import { diffWords } from 'diff';
import type { DiffHunk } from '../../shared/types.js';
import { renderMarkdown } from './markdown.js';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render markdown content, handling table rows specially.
 * Bare table rows (without header + separator) don't render as tables,
 * so we prepend a dummy header to get proper <table> output, then
 * extract just the <tbody> rows.
 */
function renderContent(value: string): string {
  if (!value.trimStart().startsWith('|')) {
    return renderMarkdown(value);
  }
  // Count columns from the first row
  const cols = (value.split('\n')[0].match(/\|/g) || []).length - 1;
  if (cols <= 0) return renderMarkdown(value);

  const header = '| ' + Array(cols).fill(' ').join(' | ') + ' |\n';
  const sep = '|' + Array(cols).fill('-').join('|') + '|\n';
  const fullTable = header + sep + value;
  const html = renderMarkdown(fullTable);

  // Extract just the tbody content
  const match = html.match(/<tbody[^>]*>([\s\S]*)<\/tbody>/);
  return match ? match[1] : html;
}

/**
 * For table removed+added pairs with different row counts, match rows
 * individually: similar rows become 'modified' with per-cell diffs,
 * unmatched removed rows stay 'removed', unmatched added rows stay 'added'.
 */
function splitTableRows(
  rRows: string[],
  aRows: string[],
  removed: DiffHunk,
  added: DiffHunk,
  result: DiffHunk[]
): void {
  // Strip the leading number column (e.g., "| 3 |") for matching since
  // renumbering shouldn't prevent a match.
  const stripNum = (row: string) => row.replace(/^\|\s*\d+\s*\|/, '|');

  // Greedy match: for each added row, find the best unmatched removed row
  const matched = new Set<number>();
  const pairs: { ri: number; ai: number }[] = [];

  for (let ai = 0; ai < aRows.length; ai++) {
    let bestRi = -1;
    let bestSim = 0;
    for (let ri = 0; ri < rRows.length; ri++) {
      if (matched.has(ri)) continue;
      const parts = diffWords(stripNum(rRows[ri]), stripNum(aRows[ai]));
      const unchanged = parts
        .filter((p) => !p.added && !p.removed)
        .reduce((s, p) => s + p.value.length, 0);
      const total = Math.max(rRows[ri].length, aRows[ai].length);
      const sim = total > 0 ? unchanged / total : 0;
      if (sim > bestSim) {
        bestSim = sim;
        bestRi = ri;
      }
    }
    if (bestRi >= 0 && bestSim >= 0.4) {
      matched.add(bestRi);
      pairs.push({ ri: bestRi, ai });
    }
  }

  // Emit unmatched removed rows
  let offset = removed.oldOffset;
  for (let ri = 0; ri < rRows.length; ri++) {
    const rowVal = rRows[ri] + '\n';
    if (!matched.has(ri)) {
      result.push({
        type: 'removed',
        value: rowVal,
        renderedValue: renderContent(rowVal),
        newOffset: added.newOffset,
        oldOffset: offset,
      });
    }
    offset += rowVal.length;
  }

  // Emit added rows and matched modified rows in added-row order
  let addOffset = added.newOffset;
  for (let ai = 0; ai < aRows.length; ai++) {
    const rowVal = aRows[ai] + '\n';
    const pair = pairs.find((p) => p.ai === ai);
    if (pair) {
      // Build per-row inline diff
      const parts = diffWords(rRows[pair.ri], aRows[ai]);
      let combined = '';
      for (const part of parts) {
        if (part.removed) combined += `<del>${escHtml(part.value)}</del>`;
        else if (part.added) combined += `<ins>${escHtml(part.value)}</ins>`;
        else combined += part.value;
      }
      result.push({
        type: 'modified',
        value: rowVal,
        renderedValue: renderContent(combined + '\n'),
        newOffset: addOffset,
        oldOffset: removed.oldOffset,
      });
    } else {
      result.push({
        type: 'added',
        value: rowVal,
        newOffset: addOffset,
        oldOffset: added.oldOffset,
      });
    }
    addOffset += rowVal.length;
  }
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

      // Table rows with different line counts: do per-row matching so
      // shared rows get inline diffs and unique rows show as added/removed.
      const isTable = removed.value.trimStart().startsWith('|');
      if (isTable && removedLines !== addedLines) {
        const rRows = removed.value.split('\n').filter((l) => l.startsWith('|'));
        const aRows = added.value.split('\n').filter((l) => l.startsWith('|'));
        splitTableRows(rRows, aRows, removed, added, result);
        i += 2;
        continue;
      }

      const maxLineRatio = isTable ? 1 : 3;

      if (similarity >= 0.4 && lineRatio <= maxLineRatio) {
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
          renderedValue: renderContent(combined),
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
      result.push({ ...h, renderedValue: renderContent(h.value) });
    } else {
      result.push(h);
    }
    i++;
  }

  return result;
}
