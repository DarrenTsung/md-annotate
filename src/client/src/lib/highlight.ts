/**
 * Injects <mark> elements into rendered HTML to highlight annotated text ranges.
 *
 * This works by walking the text nodes of the rendered HTML and wrapping
 * the ranges that correspond to annotations with <mark> elements.
 */

import type { Annotation } from '@shared/types.js';

interface HighlightRange {
  annotationId: string;
  startOffset: number;
  endOffset: number;
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
  endOffset: number
): () => void {
  return applyHighlightRanges(container, [
    {
      annotationId: '__pending__',
      startOffset,
      endOffset,
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

      // Check if this range overlaps with this block
      if (range.startOffset >= blockEnd || range.endOffset <= blockStart) {
        continue;
      }

      // Walk text nodes and find the text that matches
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

function highlightTextInElement(
  element: HTMLElement,
  range: HighlightRangeWithClass,
  blockStartOffset: number,
  marks: HTMLElement[]
): void {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let currentOffset = blockStartOffset;
  const nodesToWrap: { node: Text; start: number; end: number }[] = [];

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent || '';
    const nodeStart = currentOffset;
    const nodeEnd = currentOffset + text.length;

    // Check overlap with annotation range
    const overlapStart = Math.max(range.startOffset, nodeStart);
    const overlapEnd = Math.min(range.endOffset, nodeEnd);

    if (overlapStart < overlapEnd) {
      nodesToWrap.push({
        node,
        start: overlapStart - nodeStart,
        end: overlapEnd - nodeStart,
      });
    }

    currentOffset = nodeEnd;
  }

  // Wrap matching text nodes (process in reverse to avoid invalidating offsets)
  for (let i = nodesToWrap.length - 1; i >= 0; i--) {
    const { node, start, end } = nodesToWrap[i];
    const text = node.textContent || '';

    // Split the text node as needed
    const before = text.slice(0, start);
    const middle = text.slice(start, end);
    const after = text.slice(end);

    const mark = document.createElement('mark');
    mark.setAttribute('data-annotation-id', range.annotationId);
    mark.className = range.className ?? `annotation-highlight ${range.status === 'resolved' ? 'resolved' : ''}`;
    mark.textContent = middle;
    marks.push(mark);

    const parent = node.parentNode;
    if (!parent) continue;

    if (after) {
      const afterNode = document.createTextNode(after);
      parent.insertBefore(afterNode, node.nextSibling);
    }

    parent.insertBefore(mark, node.nextSibling);

    if (before) {
      node.textContent = before;
    } else {
      parent.removeChild(node);
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
