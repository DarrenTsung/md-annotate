/**
 * Utilities for mapping DOM selections to raw markdown character offsets.
 *
 * The markdown-it rendering adds `data-source-start` / `data-source-end`
 * attributes to block-level elements. Given a browser Selection, we:
 * 1. Walk up to find the nearest element with source offset attributes
 * 2. Compute the text offset within that block
 * 3. Fuzzy-match the selected text in the raw markdown near the estimated position
 */

export interface SourceOffset {
  startOffset: number;
  endOffset: number;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
}

const CONTEXT_LENGTH = 30;

/**
 * Find the nearest ancestor (or self) element that has data-source-start.
 */
function findSourceElement(node: Node): HTMLElement | null {
  let el: Node | null = node;
  while (el) {
    if (
      el instanceof HTMLElement &&
      el.hasAttribute('data-source-start')
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Get the text offset of a point within an element by walking its text nodes.
 */
function getTextOffsetInElement(
  container: Node,
  targetNode: Node,
  targetOffset: number
): number {
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node === targetNode) {
      return offset + targetOffset;
    }
    offset += (node.textContent || '').length;
  }
  return offset;
}

/**
 * Given the raw markdown and an approximate position, fuzzy-find the selected text.
 * Returns the best match position or falls back to the approximate position.
 */
function fuzzyFindInSource(
  rawMarkdown: string,
  selectedText: string,
  approximateStart: number
): { start: number; end: number } | null {
  if (!selectedText.trim()) return null;

  // Search in a window around the approximate position
  const windowSize = 500;
  const searchStart = Math.max(0, approximateStart - windowSize);
  const searchEnd = Math.min(
    rawMarkdown.length,
    approximateStart + selectedText.length + windowSize
  );
  const searchRegion = rawMarkdown.slice(searchStart, searchEnd);

  // Try exact match first
  const exactIdx = searchRegion.indexOf(selectedText);
  if (exactIdx !== -1) {
    const start = searchStart + exactIdx;
    return { start, end: start + selectedText.length };
  }

  // Try matching with whitespace normalization
  const normalizedSelected = selectedText.replace(/\s+/g, '\\s+');
  try {
    const regex = new RegExp(normalizedSelected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\s\+/g, '\\s+'));
    const match = regex.exec(searchRegion);
    if (match) {
      const start = searchStart + match.index;
      return { start, end: start + match[0].length };
    }
  } catch {
    // regex failed, fall through
  }

  // Try stripping markdown syntax from source and matching
  // Find the closest substring match using a sliding window
  const stripped = selectedText.replace(/\s+/g, ' ').trim();
  if (stripped.length < 3) return null;

  // Look for the first few words
  const firstWords = stripped.slice(0, Math.min(30, stripped.length));
  const idx = searchRegion.indexOf(firstWords);
  if (idx !== -1) {
    const start = searchStart + idx;
    // Find where the selection ends by matching the last few chars
    const lastChars = stripped.slice(-Math.min(20, stripped.length));
    const endRegion = rawMarkdown.slice(start, start + stripped.length + 100);
    const endIdx = endRegion.lastIndexOf(lastChars);
    if (endIdx !== -1) {
      return { start, end: start + endIdx + lastChars.length };
    }
    return { start, end: start + stripped.length };
  }

  return null;
}

/**
 * Convert a browser Selection to raw markdown source offsets.
 */
export function selectionToSourceOffset(
  selection: Selection,
  rawMarkdown: string
): SourceOffset | null {
  if (selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const selectedText = selection.toString();
  if (!selectedText.trim()) return null;

  // Find source-offset ancestors for start and end
  const startEl = findSourceElement(range.startContainer);
  const endEl = findSourceElement(range.endContainer);

  if (!startEl) return null;

  const blockStart = parseInt(startEl.getAttribute('data-source-start') || '0', 10);
  const blockEnd = parseInt(
    (endEl || startEl).getAttribute('data-source-end') || String(rawMarkdown.length),
    10
  );

  // Compute text offset within the block
  const textOffsetInBlock = getTextOffsetInElement(
    startEl,
    range.startContainer,
    range.startOffset
  );

  // Approximate source position
  const approximateStart = blockStart + textOffsetInBlock;

  // Fuzzy find in raw source
  const match = fuzzyFindInSource(rawMarkdown, selectedText, approximateStart);

  if (!match) {
    // Fallback: use block-level offsets
    return {
      startOffset: blockStart,
      endOffset: blockEnd,
      selectedText,
      contextBefore: rawMarkdown.slice(
        Math.max(0, blockStart - CONTEXT_LENGTH),
        blockStart
      ),
      contextAfter: rawMarkdown.slice(blockEnd, blockEnd + CONTEXT_LENGTH),
    };
  }

  return {
    startOffset: match.start,
    endOffset: match.end,
    selectedText: rawMarkdown.slice(match.start, match.end),
    contextBefore: rawMarkdown.slice(
      Math.max(0, match.start - CONTEXT_LENGTH),
      match.start
    ),
    contextAfter: rawMarkdown.slice(match.end, match.end + CONTEXT_LENGTH),
  };
}
