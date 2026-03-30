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

  // Try exact match — find the occurrence closest to approximateStart
  let exactIdx = -1;
  let bestDistance = Infinity;
  let searchFrom = 0;
  while (true) {
    const idx = searchRegion.indexOf(selectedText, searchFrom);
    if (idx === -1) break;
    const absPos = searchStart + idx;
    const distance = Math.abs(absPos - approximateStart);
    if (distance < bestDistance) {
      bestDistance = distance;
      exactIdx = idx;
    }
    searchFrom = idx + 1;
  }
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
 * Build a position map from rendered-text indices to raw-source indices by
 * stripping markdown syntax (links, bold/italic markers, list prefixes,
 * backticks). Returns an array where map[renderedPos] = rawPos.
 */
function buildSourceMap(rawBlock: string): number[] {
  const map: number[] = [];
  let i = 0;

  // Skip leading block-level markers that aren't in the rendered text:
  // list markers (- , * , 1. ), heading markers (## ), blockquote (> )
  const prefixMatch = rawBlock.match(/^(\s*[-*+]\s|\s*\d+\.\s|#{1,6}\s|>\s*)/);
  if (prefixMatch) i = prefixMatch[0].length;

  while (i < rawBlock.length) {
    // Markdown link: [text](url) → keep text positions, skip brackets and URL
    if (rawBlock[i] === '[') {
      const closeBracket = rawBlock.indexOf(']', i + 1);
      if (closeBracket !== -1 && closeBracket + 1 < rawBlock.length && rawBlock[closeBracket + 1] === '(') {
        const closeParen = rawBlock.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          for (let j = i + 1; j < closeBracket; j++) {
            map.push(j);
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Bold/italic markers: *, **, ***, _, __, ___
    if (rawBlock[i] === '*' || rawBlock[i] === '_') {
      let count = 0;
      while (i + count < rawBlock.length && rawBlock[i + count] === rawBlock[i]) count++;
      if (count <= 3) { i += count; continue; }
    }

    // Inline code backticks
    if (rawBlock[i] === '`' && (i + 1 >= rawBlock.length || rawBlock[i + 1] !== '`')) {
      i++;
      continue;
    }

    // Skip trailing newlines (not in rendered text)
    if (rawBlock[i] === '\n' && i === rawBlock.length - 1) {
      i++;
      continue;
    }

    map.push(i);
    i++;
  }

  return map;
}

/**
 * Map a text offset within a rendered block to a source offset using an
 * explicit syntax-stripping map. Falls back to linear interpolation if the
 * map doesn't cover the offset.
 */
function textOffsetToSourceOffset(
  textOffset: number,
  rawMarkdown: string,
  blockSourceStart: number,
  blockSourceEnd: number
): number {
  const rawBlock = rawMarkdown.slice(blockSourceStart, blockSourceEnd);
  const posMap = buildSourceMap(rawBlock);
  if (textOffset < posMap.length) {
    return blockSourceStart + posMap[textOffset];
  }
  // Past the end of the map → return block end
  return blockSourceEnd;
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

  const startBlockStart = parseInt(startEl.getAttribute('data-source-start') || '0', 10);
  const startBlockEnd = parseInt(startEl.getAttribute('data-source-end') || String(rawMarkdown.length), 10);
  const effectiveEndEl = endEl || startEl;
  const endBlockStart = parseInt(effectiveEndEl.getAttribute('data-source-start') || '0', 10);
  const endBlockEnd = parseInt(effectiveEndEl.getAttribute('data-source-end') || String(rawMarkdown.length), 10);

  // Compute text offset within the start block
  const startTextOffset = getTextOffsetInElement(
    startEl,
    range.startContainer,
    range.startOffset
  );

  // Single-block selection: use existing fuzzy match
  if (startEl === effectiveEndEl) {
    const approximateStart = startBlockStart + startTextOffset;
    const match = fuzzyFindInSource(rawMarkdown, selectedText, approximateStart);

    if (match) {
      return {
        startOffset: match.start,
        endOffset: match.end,
        selectedText: rawMarkdown.slice(match.start, match.end),
        contextBefore: rawMarkdown.slice(Math.max(0, match.start - CONTEXT_LENGTH), match.start),
        contextAfter: rawMarkdown.slice(match.end, match.end + CONTEXT_LENGTH),
      };
    }
  }

  // Cross-block selection (or single-block fuzzy match failed): compute
  // start and end independently using the text-to-source ratio within
  // each block. This handles markdown syntax (links, bold) where rendered
  // text is shorter than raw source.
  const startSourceOffset = textOffsetToSourceOffset(
    startTextOffset,
    rawMarkdown,
    startBlockStart,
    startBlockEnd
  );

  const endTextOffset = getTextOffsetInElement(
    effectiveEndEl,
    range.endContainer,
    range.endOffset
  );
  const endSourceOffset = textOffsetToSourceOffset(
    endTextOffset,
    rawMarkdown,
    endBlockStart,
    endBlockEnd
  );

  // Use the mapped positions directly (already precise from the source map)
  const refinedStart = startSourceOffset;
  const refinedEnd = endSourceOffset;

  return {
    startOffset: refinedStart,
    endOffset: refinedEnd,
    // Use the browser's rendered selection text (without markdown syntax)
    // for display. The startOffset/endOffset + context are used for
    // re-anchoring which works on raw source positions.
    selectedText,
    contextBefore: rawMarkdown.slice(Math.max(0, refinedStart - CONTEXT_LENGTH), refinedStart),
    contextAfter: rawMarkdown.slice(refinedEnd, refinedEnd + CONTEXT_LENGTH),
  };
}
