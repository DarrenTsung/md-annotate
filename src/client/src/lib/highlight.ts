/**
 * Injects <mark> elements into rendered HTML to highlight annotated text ranges.
 *
 * Highlights are positioned by searching for the annotation's selectedText
 * within the block element's rendered text content. Raw markdown offsets are
 * only used to identify which block(s) an annotation belongs to — the
 * within-block positioning uses rendered text matching to avoid drift caused
 * by markdown syntax stripping.
 */

import type { Annotation } from '@shared/types.js';

interface HighlightRange {
  annotationId: string;
  startOffset: number;
  endOffset: number;
  selectedText?: string;
  status: 'open' | 'resolved';
}

/**
 * Given a container element and annotations, inject <mark> highlights.
 * Returns a cleanup function that removes the highlights.
 */
export function applyHighlights(
  container: HTMLElement,
  annotations: Annotation[]
): () => void {
  const ranges = annotations.map(
    (a): HighlightRange => ({
      annotationId: a.id,
      startOffset: a.startOffset,
      endOffset: a.endOffset,
      selectedText: a.selectedText,
      status: a.status,
    })
  );

  return applyHighlightRanges(container, ranges);
}

/**
 * Inject <mark> elements for a pending text selection.
 * Uses a distinct CSS class so it can be styled differently.
 */
export function applyPendingHighlight(
  container: HTMLElement,
  startOffset: number,
  endOffset: number,
  selectedText?: string
): () => void {
  return applyHighlightRanges(container, [
    {
      annotationId: '__pending__',
      startOffset,
      endOffset,
      selectedText,
      status: 'pending' as 'open',
      className: 'pending-highlight',
    },
  ]);
}

interface HighlightRangeWithClass extends HighlightRange {
  className?: string;
}

function applyHighlightRanges(
  container: HTMLElement,
  ranges: HighlightRangeWithClass[]
): () => void {
  // Sort by start offset
  ranges.sort((a, b) => a.startOffset - b.startOffset);

  // For each range, find the block element(s) that contain it and
  // wrap the matching text in <mark> elements
  const marks: HTMLElement[] = [];

  for (const range of ranges) {
    const blockElements = container.querySelectorAll('[data-source-start]');

    for (const block of blockElements) {
      const el = block as HTMLElement;
      const blockStart = parseInt(el.getAttribute('data-source-start') || '0', 10);
      const blockEnd = parseInt(
        el.getAttribute('data-source-end') || '0',
        10
      );

      // Check if this range overlaps with this block (using raw offsets)
      if (range.startOffset >= blockEnd || range.endOffset <= blockStart) {
        continue;
      }

      highlightTextInElement(el, range, blockStart, marks);
    }
  }

  return () => {
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
    }
  };
}

/**
 * Find all occurrences of `needle` in `haystack` and return their start indices.
 */
function findAllOccurrences(haystack: string, needle: string): number[] {
  const indices: number[] = [];
  let pos = 0;
  while (pos <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    indices.push(idx);
    pos = idx + 1;
  }
  return indices;
}

function highlightTextInElement(
  element: HTMLElement,
  range: HighlightRangeWithClass,
  blockStartOffset: number,
  marks: HTMLElement[]
): void {
  // Collect all text nodes and build the full rendered text
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let fullText = '';
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    textNodes.push(node);
    fullText += node.textContent || '';
  }

  // Find the highlight range within the rendered text
  let matchStart: number;
  let matchEnd: number;

  if (range.selectedText && range.selectedText.length > 0) {
    // Search for the selectedText in the block's rendered text
    const occurrences = findAllOccurrences(fullText, range.selectedText);

    if (occurrences.length === 0) {
      // Try whitespace-normalized match
      const normalized = range.selectedText.replace(/\s+/g, ' ');
      const normalizedFull = fullText.replace(/\s+/g, ' ');
      const idx = normalizedFull.indexOf(normalized);
      if (idx === -1) return;
      // Map back to original positions approximately
      matchStart = idx;
      matchEnd = idx + normalized.length;
    } else if (occurrences.length === 1) {
      matchStart = occurrences[0];
      matchEnd = matchStart + range.selectedText.length;
    } else {
      // Multiple occurrences — pick the one closest to the expected
      // position based on the raw offset's proportion within the block
      const blockEnd = parseInt(
        element.getAttribute('data-source-end') || String(blockStartOffset + fullText.length),
        10
      );
      const rawBlockLength = blockEnd - blockStartOffset;
      const relativePos = rawBlockLength > 0
        ? (range.startOffset - blockStartOffset) / rawBlockLength
        : 0;
      const expectedPos = Math.round(relativePos * fullText.length);

      let bestIdx = occurrences[0];
      let bestDist = Math.abs(bestIdx - expectedPos);
      for (let i = 1; i < occurrences.length; i++) {
        const dist = Math.abs(occurrences[i] - expectedPos);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = occurrences[i];
        }
      }
      matchStart = bestIdx;
      matchEnd = matchStart + range.selectedText.length;
    }
  } else {
    // No selectedText available — fall back to offset-based positioning
    // (less accurate but works for pending highlights without selectedText)
    matchStart = range.startOffset - blockStartOffset;
    matchEnd = range.endOffset - blockStartOffset;
  }

  // Clamp to rendered text bounds
  matchStart = Math.max(0, Math.min(matchStart, fullText.length));
  matchEnd = Math.max(matchStart, Math.min(matchEnd, fullText.length));
  if (matchStart >= matchEnd) return;

  // Map match positions back to text nodes
  const nodesToWrap: { node: Text; start: number; end: number }[] = [];
  let currentPos = 0;

  for (const textNode of textNodes) {
    const text = textNode.textContent || '';
    const nodeStart = currentPos;
    const nodeEnd = currentPos + text.length;

    const overlapStart = Math.max(matchStart, nodeStart);
    const overlapEnd = Math.min(matchEnd, nodeEnd);

    if (overlapStart < overlapEnd) {
      nodesToWrap.push({
        node: textNode,
        start: overlapStart - nodeStart,
        end: overlapEnd - nodeStart,
      });
    }

    currentPos = nodeEnd;
  }

  // Wrap matching text nodes (process in reverse to avoid invalidating offsets)
  for (let i = nodesToWrap.length - 1; i >= 0; i--) {
    const { node: textNode, start, end } = nodesToWrap[i];
    const text = textNode.textContent || '';

    const before = text.slice(0, start);
    const middle = text.slice(start, end);
    const after = text.slice(end);

    const mark = document.createElement('mark');
    mark.setAttribute('data-annotation-id', range.annotationId);
    mark.className = range.className ?? `annotation-highlight ${range.status === 'resolved' ? 'resolved' : ''}`;
    mark.textContent = middle;
    marks.push(mark);

    const parent = textNode.parentNode;
    if (!parent) continue;

    if (after) {
      const afterNode = document.createTextNode(after);
      parent.insertBefore(afterNode, textNode.nextSibling);
    }

    parent.insertBefore(mark, textNode.nextSibling);

    if (before) {
      textNode.textContent = before;
    } else {
      parent.removeChild(textNode);
    }
  }
}

/**
 * Get the vertical position of a highlight for sidebar alignment.
 */
export function getHighlightPosition(annotationId: string): number | null {
  const mark = document.querySelector(
    `mark[data-annotation-id="${annotationId}"]`
  );
  if (!mark) return null;

  const rect = mark.getBoundingClientRect();
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
  return rect.top + scrollTop;
}
