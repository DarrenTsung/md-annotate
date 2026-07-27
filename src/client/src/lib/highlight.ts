/**
 * Injects <mark> elements into rendered HTML to highlight annotated text ranges.
 *
 * Highlights are positioned by searching for the annotation's selectedText
 * within the block element's rendered text content. Raw markdown offsets are
 * only used to identify which block(s) an annotation belongs to — the
 * within-block positioning uses rendered text matching to avoid drift caused
 * by markdown syntax stripping.
 */

import type { Annotation, MermaidLabelTarget } from '@shared/types.js';
import { buildSourceMap } from './offsets.js';
import { findMermaidLabelIndex } from './mermaid.js';

interface HighlightRange {
  annotationId: string;
  startOffset: number;
  endOffset: number;
  selectedText?: string;
  status: string;
  stale?: boolean;
  working?: boolean;
}

/**
 * Given a container element and annotations, inject <mark> highlights.
 * Returns a cleanup function that removes the highlights.
 */
export function applyHighlights(
  container: HTMLElement,
  annotations: Annotation[],
  rawMarkdown?: string
): () => void {
  const ranges = annotations
    .filter((annotation) => !annotation.mermaidLabel)
    .map(
      (a): HighlightRange => ({
        annotationId: a.id,
        startOffset: a.startOffset,
        endOffset: a.endOffset,
        selectedText: a.selectedText,
        status: a.status,
        stale: a.stale,
        working: a.working,
      })
    );
  const mermaidRanges = annotations.flatMap(
    (annotation): MermaidHighlightRange[] =>
      annotation.mermaidLabel
        ? [
            {
              annotationId: annotation.id,
              startOffset: annotation.startOffset,
              endOffset: annotation.endOffset,
              target: annotation.mermaidLabel,
              status: annotation.status,
              stale: annotation.stale,
              working: annotation.working,
            },
          ]
        : []
  );

  const cleanupText = applyHighlightRanges(container, ranges, rawMarkdown);
  const cleanupMermaid = applyMermaidHighlights(container, mermaidRanges);
  return () => {
    cleanupMermaid();
    cleanupText();
  };
}

/**
 * Inject <mark> elements for a pending text selection.
 * Uses a distinct CSS class so it can be styled differently.
 */
export function applyPendingHighlight(
  container: HTMLElement,
  startOffset: number,
  endOffset: number,
  selectedText?: string,
  rawMarkdown?: string,
  mermaidLabel?: MermaidLabelTarget
): () => void {
  if (mermaidLabel) {
    return applyMermaidHighlights(
      container,
      [
        {
          annotationId: '__pending__',
          startOffset,
          endOffset,
          target: mermaidLabel,
          status: 'pending',
          working: false,
        },
      ],
      'pending-highlight'
    );
  }

  return applyHighlightRanges(
    container,
    [
      {
        annotationId: '__pending__',
        startOffset,
        endOffset,
        selectedText,
        status: 'pending' as 'open',
        className: 'pending-highlight',
      },
    ],
    rawMarkdown
  );
}

interface HighlightRangeWithClass extends HighlightRange {
  className?: string;
}

interface MermaidHighlightRange {
  annotationId: string;
  startOffset: number;
  endOffset: number;
  target: MermaidLabelTarget;
  status: string;
  stale?: boolean;
  working?: boolean;
}

function applyMermaidHighlights(
  container: HTMLElement,
  ranges: MermaidHighlightRange[],
  className?: string
): () => void {
  const marks: Element[] = [];
  const insertedElements: Element[] = [];
  const diagrams = Array.from(
    container.querySelectorAll(
      '.mermaid-diagram[data-source-start][data-source-end]'
    )
  );

  for (const range of ranges) {
    const target = range.target;
    if (range.stale) continue;

    const diagram = diagrams.find((element) => {
      const start = parseInt(
        element.getAttribute('data-source-start') || '',
        10
      );
      const end = parseInt(element.getAttribute('data-source-end') || '', 10);
      return range.startOffset < end && range.endOffset > start;
    });
    if (!diagram) continue;

    const labels = Array.from(
      diagram.querySelectorAll('[data-mermaid-label]')
    );
    const labelIndex = findMermaidLabelIndex(
      labels.map(
        (element) => element.getAttribute('data-mermaid-label-text') || ''
      ),
      target.text,
      target.occurrence
    );
    const label = labelIndex === null ? null : labels[labelIndex];
    if (!label) {
      const missing = document.createElement('button');
      missing.type = 'button';
      missing.className =
        'annotation-highlight stale mermaid-missing-highlight';
      missing.setAttribute('data-annotation-id', range.annotationId);
      missing.textContent = `Comment target "${target.text.slice(
        target.selectionStart,
        target.selectionEnd
      )}" not found`;
      diagram.insertBefore(missing, diagram.firstChild);
      insertedElements.push(missing);
      continue;
    }

    highlightTextInElement(
      label,
      {
        annotationId: range.annotationId,
        startOffset: target.selectionStart,
        endOffset: target.selectionEnd,
        selectedText: target.text.slice(
          target.selectionStart,
          target.selectionEnd
        ),
        status: range.status,
        stale: range.stale,
        working: range.working,
        className,
      },
      0,
      marks
    );
  }

  return () => {
    for (const element of insertedElements) {
      element.parentNode?.removeChild(element);
    }
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

function applyHighlightRanges(
  container: HTMLElement,
  ranges: HighlightRangeWithClass[],
  rawMarkdown?: string
): () => void {
  // Sort by start offset
  ranges.sort((a, b) => a.startOffset - b.startOffset);

  // For each range, find the block element(s) that contain it and
  // wrap the matching text in <mark> elements
  const marks: Element[] = [];

  for (const range of ranges) {
    const blockElements = Array.from(
      container.querySelectorAll('[data-source-start]:not(.mermaid-diagram)')
    );

    // Find blocks that overlap this range
    const overlapping = blockElements.filter((el) => {
      const blockStart = parseInt(el.getAttribute('data-source-start') || '0', 10);
      const blockEnd = parseInt(el.getAttribute('data-source-end') || '0', 10);
      return range.startOffset < blockEnd && range.endOffset > blockStart;
    });

    // Keep only the most specific blocks (filter out parents whose
    // children also overlap — e.g. a <ul> when individual <li>s match)
    const leafBlocks = overlapping.filter(
      (block) => !overlapping.some((o) => o !== block && block.contains(o))
    );

    for (const el of leafBlocks) {
      const blockStart = parseInt(el.getAttribute('data-source-start') || '0', 10);
      highlightTextInElement(el, range, blockStart, marks, rawMarkdown);
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
  element: Element,
  range: HighlightRangeWithClass,
  blockStartOffset: number,
  marks: Element[],
  rawMarkdown?: string
): void {
  // Collect all text nodes and build the full rendered text.
  // Skip text inside .action-buttons so highlights don't cover action buttons.
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (
        node.parentElement?.closest(
          '.action-buttons, .footnote-ref, .footnote-backref'
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      // Skip text nodes that are direct children of table-structural
      // elements (the whitespace between cells/rows). Wrapping these in a
      // <mark> would place phrasing content directly inside <tr>/<tbody>/…,
      // which is invalid HTML and mangles the table layout.
      const parentTag = node.parentElement?.tagName;
      if (
        parentTag === 'TR' ||
        parentTag === 'TABLE' ||
        parentTag === 'THEAD' ||
        parentTag === 'TBODY' ||
        parentTag === 'TFOOT'
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
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

  const blockEnd = parseInt(
    element.getAttribute('data-source-end') || String(blockStartOffset + fullText.length),
    10
  );

  if (range.selectedText && range.selectedText.length > 0) {
    // Search for the selectedText in the block's rendered text
    const occurrences = findAllOccurrences(fullText, range.selectedText);

    if (occurrences.length === 1) {
      matchStart = occurrences[0];
      matchEnd = matchStart + range.selectedText.length;
    } else if (occurrences.length > 1) {
      // Multiple occurrences — pick the one closest to the expected
      // position based on the raw offset's proportion within the block
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
    } else {
      // No exact match in this block's rendered text.
      if (range.stale) {
        // Stale annotation: text was edited and offsets are unreliable.
        // Don't render a bogus highlight at wrong positions.
        return;
      }
      // Non-stale: selection may span multiple blocks.
      // Highlight the portion of this block that overlaps the selection's
      // raw offset range.
      const overlapStart = Math.max(range.startOffset, blockStartOffset);
      const overlapEnd = Math.min(range.endOffset, blockEnd);
      if (overlapStart >= overlapEnd) return;

      // Use source map for accurate raw→rendered offset mapping when
      // raw markdown is available. Falls back to ratio for legacy data.
      if (rawMarkdown) {
        const rawBlock = rawMarkdown.slice(blockStartOffset, blockEnd);
        const srcMap = buildSourceMap(rawBlock, {
          footnoteReferenceLabels: Array.from(
            element.querySelectorAll(
              '.footnote-ref[data-footnote-label]'
            )
          ).flatMap((reference) => {
            const label = reference.getAttribute('data-footnote-label');
            return label ? [label] : [];
          }),
          skipFootnoteDefinitionPrefix: Boolean(
            element.closest('.footnote-item')
          ),
          codeBlock: Boolean(element.closest('pre')),
        });
        // Reverse lookup: find the rendered text index for a raw offset
        const rawToText = (rawOff: number): number => {
          const relRaw = rawOff - blockStartOffset;
          // Find the first map entry >= relRaw
          for (let idx = 0; idx < srcMap.length; idx++) {
            if (srcMap[idx] >= relRaw) return idx;
          }
          return srcMap.length;
        };
        matchStart = rawToText(overlapStart);
        matchEnd = rawToText(overlapEnd);
      } else {
        const rawBlockLength = blockEnd - blockStartOffset;
        const ratio = rawBlockLength > 0 ? fullText.length / rawBlockLength : 1;
        matchStart = Math.round((overlapStart - blockStartOffset) * ratio);
        matchEnd = Math.round((overlapEnd - blockStartOffset) * ratio);
      }
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

    const parent = textNode.parentNode;
    if (!parent) continue;

    const isSvgText = parent instanceof SVGElement && !parent.closest('foreignObject');
    const mark = isSvgText
      ? document.createElementNS('http://www.w3.org/2000/svg', 'tspan')
      : document.createElement('mark');
    mark.setAttribute('data-annotation-id', range.annotationId);
    mark.setAttribute(
      'class',
      range.className ??
        `annotation-highlight ${range.status === 'resolved' ? 'resolved' : ''} ${range.stale ? 'stale' : ''} ${range.working ? 'working' : ''}`.trim()
    );
    mark.textContent = middle;
    marks.push(mark);

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
    `.annotation-highlight[data-annotation-id="${annotationId}"]`
  );
  if (!mark) return null;

  const rect = mark.getBoundingClientRect();
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
  return rect.top + scrollTop;
}
