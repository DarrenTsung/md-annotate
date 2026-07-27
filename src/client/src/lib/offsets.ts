/**
 * Utilities for mapping DOM selections to raw markdown character offsets.
 *
 * The markdown-it rendering adds `data-source-start` / `data-source-end`
 * attributes to block-level elements. Given a browser Selection, we:
 * 1. Walk up to find the nearest element with source offset attributes
 * 2. Compute the text offset within that block
 * 3. Fuzzy-match the selected text in the raw markdown near the estimated position
 */

import type { MermaidLabelTarget } from '@shared/types.js';
import { findMermaidBlockAnchor } from './mermaid.js';

export interface SourceOffset {
  startOffset: number;
  endOffset: number;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  mermaidLabel?: MermaidLabelTarget;
}

const CONTEXT_LENGTH = 30;
const GENERATED_CONTROL_SELECTOR = '.footnote-ref, .footnote-backref';

export interface SourceMapOptions {
  footnoteReferenceLabels?: string[];
  skipFootnoteDefinitionPrefix?: boolean;
  codeBlock?: boolean;
}

/**
 * Find the nearest ancestor (or self) element that has data-source-start.
 */
function findSourceElement(node: Node): Element | null {
  let el: Node | null = node;
  while (el) {
    if (
      el instanceof Element &&
      el.hasAttribute('data-source-start')
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

function findClosestElement(node: Node, selector: string): Element | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(selector) ?? null;
}

/**
 * Get the text offset of a point within an element. Uses a Range so that
 * element endpoints (e.g. `endContainer = <li>, endOffset = 1`, which the
 * browser commonly produces when a double-click+drag selection lands at the
 * boundary between blocks) resolve correctly. A text-node walk would miss
 * the element target and silently return the block's full text length,
 * which then expands the selection across the entire next block.
 */
function getTextOffsetInElement(
  container: Node,
  targetNode: Node,
  targetOffset: number
): number {
  const range = document.createRange();
  range.selectNodeContents(container);
  try {
    range.setEnd(targetNode, targetOffset);
  } catch {
    return 0;
  }
  return getRangeText(range).length;
}

function getRangeText(range: Range): string {
  const contents = range.cloneContents();
  contents
    .querySelectorAll(GENERATED_CONTROL_SELECTOR)
    .forEach((element) => element.remove());
  return contents.textContent ?? '';
}

function isInsideGeneratedControl(node: Node): boolean {
  return Boolean(findClosestElement(node, GENERATED_CONTROL_SELECTOR));
}

function sourceMapOptionsForElement(element: Element): SourceMapOptions {
  return {
    footnoteReferenceLabels: Array.from(
      element.querySelectorAll('.footnote-ref[data-footnote-label]')
    ).flatMap((reference) => {
      const label = reference.getAttribute('data-footnote-label');
      return label ? [label] : [];
    }),
    skipFootnoteDefinitionPrefix: Boolean(element.closest('.footnote-item')),
    codeBlock: Boolean(element.closest('pre')),
  };
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
 * stripping all markdown syntax that doesn't appear in rendered output.
 * Returns an array where map[renderedPos] = rawPos.
 */
export function buildSourceMap(
  rawBlock: string,
  options: SourceMapOptions = {}
): number[] {
  const map: number[] = [];
  const len = rawBlock.length;

  function skipFootnotePrefix(position: number): number {
    let next = position;
    if (options.skipFootnoteDefinitionPrefix) {
      const footnotePrefix = rawBlock
        .slice(next)
        .match(/^\[\^[^\]\s]+\]:[ \t]*/);
      if (footnotePrefix) {
        next += footnotePrefix[0].length;
      } else {
        const continuationIndent = rawBlock
          .slice(next)
          .match(/^(?: {4}|\t)/);
        if (continuationIndent) next += continuationIndent[0].length;
      }
    }
    return next;
  }

  function lineEnd(position: number): number {
    const newline = rawBlock.indexOf('\n', position);
    return newline === -1 ? len : newline;
  }

  function buildCodeBlockMap(): number[] {
    type CodeContainer =
      | { kind: 'blockquote' }
      | { kind: 'list'; width: number };

    function skipOpeningContainers(
      position: number
    ): { position: number; containers: CodeContainer[] } {
      let next = position;
      const containers: CodeContainer[] = [];
      while (next < len) {
        const blockquote = rawBlock.slice(next).match(/^ {0,3}>[ \t]?/);
        if (blockquote) {
          next += blockquote[0].length;
          containers.push({ kind: 'blockquote' });
          continue;
        }

        const list = rawBlock
          .slice(next)
          .match(/^(?: {0,3})(?:[-+*]|\d+[.)])[ \t]+/);
        if (list) {
          next += list[0].length;
          containers.push({ kind: 'list', width: list[0].length });
          continue;
        }
        break;
      }
      return { position: next, containers };
    }

    function skipContinuationContainers(
      position: number,
      containers: CodeContainer[]
    ): number {
      let next = position;
      for (const container of containers) {
        if (container.kind === 'blockquote') {
          const blockquote = rawBlock.slice(next).match(/^ {0,3}>[ \t]?/);
          if (blockquote) next += blockquote[0].length;
          continue;
        }

        let remaining = container.width;
        while (
          remaining > 0 &&
          (rawBlock[next] === ' ' || rawBlock[next] === '\t')
        ) {
          next++;
          remaining--;
        }
      }
      return next;
    }

    const codeMap: number[] = [];
    const firstLine = skipOpeningContainers(skipFootnotePrefix(0));
    const firstContentStart = firstLine.position;
    const firstLineEnd = lineEnd(firstContentStart);
    const openingFence = rawBlock
      .slice(firstContentStart, firstLineEnd)
      .match(/^( {0,3})(`{3,}|~{3,})/);
    let position = 0;

    if (openingFence) {
      const fenceIndent = openingFence[1].length;
      const fenceCharacter = openingFence[2][0];
      const fenceLength = openingFence[2].length;
      position = firstLineEnd < len ? firstLineEnd + 1 : len;

      while (position < len) {
        let contentStart = skipFootnotePrefix(position);
        contentStart = skipContinuationContainers(
          contentStart,
          firstLine.containers
        );
        const contentEnd = lineEnd(contentStart);
        const closingFence = rawBlock
          .slice(contentStart, contentEnd)
          .match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
        if (
          closingFence &&
          closingFence[1][0] === fenceCharacter &&
          closingFence[1].length >= fenceLength
        ) {
          break;
        }

        let remainingIndent = fenceIndent;
        while (
          remainingIndent > 0 &&
          rawBlock[contentStart] === ' '
        ) {
          contentStart++;
          remainingIndent--;
        }
        for (let sourceIndex = contentStart; sourceIndex < contentEnd; sourceIndex++) {
          codeMap.push(sourceIndex);
        }
        if (contentEnd < len) codeMap.push(contentEnd);
        position = contentEnd + 1;
      }

      return codeMap;
    }

    while (position < len) {
      let contentStart = skipFootnotePrefix(position);
      contentStart = skipContinuationContainers(
        contentStart,
        firstLine.containers
      );
      const codeIndent = rawBlock.slice(contentStart).match(/^(?: {4}|\t)/);
      if (codeIndent) contentStart += codeIndent[0].length;
      const contentEnd = lineEnd(contentStart);
      for (let sourceIndex = contentStart; sourceIndex < contentEnd; sourceIndex++) {
        codeMap.push(sourceIndex);
      }
      if (contentEnd < len) codeMap.push(contentEnd);
      position = contentEnd + 1;
    }

    return codeMap;
  }

  if (options.codeBlock) return buildCodeBlockMap();

  function skipLinePrefixes(position: number): number {
    let next = skipFootnotePrefix(position);

    while (next < len) {
      const blockPrefix = rawBlock.slice(next).match(
        /^(?:[ \t]*>[ \t]*|[ \t]*[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|[ \t]*\d+[.)][ \t]+(?:\[[ xX]\][ \t]+)?|[ \t]{0,3}#{1,6}[ \t]+)/
      );
      if (!blockPrefix) break;
      next += blockPrefix[0].length;
    }
    return next;
  }

  let i = skipLinePrefixes(0);

  while (i < len) {
    const ch = rawBlock[i];

    // Trailing newline (not in rendered text)
    if (ch === '\n' && i === len - 1) { i++; continue; }
    if (ch === '\n') {
      map.push(i);
      i = skipLinePrefixes(i + 1);
      continue;
    }

    // Escape backslash: skip the backslash, keep the escaped char
    if (ch === '\\' && i + 1 < len && /[\\`*_{}[\]()#+\-.!~>|]/.test(rawBlock[i + 1])) {
      i++; // skip backslash
      map.push(i); // keep escaped char
      i++;
      continue;
    }

    // Image: ![alt](url) → keep alt text, skip ! and brackets/URL
    if (ch === '!' && i + 1 < len && rawBlock[i + 1] === '[') {
      const closeBracket = rawBlock.indexOf(']', i + 2);
      if (closeBracket !== -1 && closeBracket + 1 < len && rawBlock[closeBracket + 1] === '(') {
        const closeParen = rawBlock.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          for (let j = i + 2; j < closeBracket; j++) map.push(j);
          i = closeParen + 1;
          continue;
        }
      }
    }

    if (ch === '[' && rawBlock[i + 1] === '^') {
      const closeBracket = rawBlock.indexOf(']', i + 2);
      const label = rawBlock.slice(i + 2, closeBracket);
      if (options.footnoteReferenceLabels?.includes(label)) {
        i = closeBracket + 1;
        continue;
      }
    }

    // Link: [text](url) → keep text, skip brackets and URL
    if (ch === '[') {
      const closeBracket = rawBlock.indexOf(']', i + 1);
      if (closeBracket !== -1 && closeBracket + 1 < len && rawBlock[closeBracket + 1] === '(') {
        const closeParen = rawBlock.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          for (let j = i + 1; j < closeBracket; j++) map.push(j);
          i = closeParen + 1;
          continue;
        }
      }
      // Reference link: [text][ref] → keep text
      if (closeBracket !== -1 && closeBracket + 1 < len && rawBlock[closeBracket + 1] === '[') {
        const closeRef = rawBlock.indexOf(']', closeBracket + 2);
        if (closeRef !== -1) {
          for (let j = i + 1; j < closeBracket; j++) map.push(j);
          i = closeRef + 1;
          continue;
        }
      }
    }

    // Strikethrough: ~~text~~ → skip the ~~ markers
    if (ch === '~' && i + 1 < len && rawBlock[i + 1] === '~') {
      i += 2;
      continue;
    }

    // Bold/italic: *, **, ***, _, __, ___ → skip markers
    if (ch === '*' || ch === '_') {
      let count = 0;
      while (i + count < len && rawBlock[i + count] === ch) count++;
      if (count <= 3) { i += count; continue; }
    }

    // Inline code: `text` or ``text`` → skip backtick delimiters
    if (ch === '`') {
      let ticks = 0;
      while (i + ticks < len && rawBlock[i + ticks] === '`') ticks++;
      // Skip opening backticks
      i += ticks;
      // Map content until matching closing backticks
      while (i < len) {
        let closeTicks = 0;
        while (i + closeTicks < len && rawBlock[i + closeTicks] === '`') closeTicks++;
        if (closeTicks === ticks) { i += ticks; break; }
        if (closeTicks > 0) {
          // Non-matching backticks are content
          for (let j = 0; j < closeTicks; j++) { map.push(i + j); }
          i += closeTicks;
        } else {
          map.push(i);
          i++;
        }
      }
      continue;
    }

    // HTML tags: <tag> or </tag> or <tag attr="val"> → skip
    if (ch === '<' && i + 1 < len && (rawBlock[i + 1] === '/' || /[a-zA-Z]/.test(rawBlock[i + 1]))) {
      const closeAngle = rawBlock.indexOf('>', i + 1);
      if (closeAngle !== -1) { i = closeAngle + 1; continue; }
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
  blockSourceEnd: number,
  options: SourceMapOptions
): number {
  const rawBlock = rawMarkdown.slice(blockSourceStart, blockSourceEnd);
  const posMap = buildSourceMap(rawBlock, options);
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
  if (
    isInsideGeneratedControl(range.startContainer) ||
    isInsideGeneratedControl(range.endContainer)
  ) {
    return null;
  }
  const selectedText = getRangeText(range);
  if (!selectedText.trim()) return null;

  const startMermaidLabel = findClosestElement(
    range.startContainer,
    '[data-mermaid-label]'
  );
  const endMermaidLabel = findClosestElement(
    range.endContainer,
    '[data-mermaid-label]'
  );
  if (startMermaidLabel || endMermaidLabel) {
    if (!startMermaidLabel || startMermaidLabel !== endMermaidLabel) return null;
    const diagram = startMermaidLabel.closest(
      '.mermaid-diagram[data-source-start][data-source-end]'
    );
    if (!diagram) return null;

    const startOffset = parseInt(
      diagram.getAttribute('data-source-start') || '',
      10
    );
    const endOffset = parseInt(
      diagram.getAttribute('data-source-end') || '',
      10
    );
    const occurrence = parseInt(
      startMermaidLabel.getAttribute('data-mermaid-label-occurrence') || '',
      10
    );
    if (
      !Number.isFinite(startOffset) ||
      !Number.isFinite(endOffset) ||
      !Number.isFinite(occurrence) ||
      startOffset >= endOffset
    ) {
      return null;
    }

    const labelText =
      startMermaidLabel.getAttribute('data-mermaid-label-text') || '';
    const selectionStart = getTextOffsetInElement(
      startMermaidLabel,
      range.startContainer,
      range.startOffset
    );
    const selectionEnd = getTextOffsetInElement(
      startMermaidLabel,
      range.endContainer,
      range.endOffset
    );
    if (selectionStart >= selectionEnd || selectionEnd > labelText.length) {
      return null;
    }

    const anchor = findMermaidBlockAnchor(
      rawMarkdown,
      startOffset,
      endOffset
    );
    if (!anchor) return null;

    return {
      startOffset: anchor.start,
      endOffset: anchor.end,
      selectedText: anchor.text,
      contextBefore: rawMarkdown.slice(
        Math.max(0, anchor.start - CONTEXT_LENGTH),
        anchor.start
      ),
      contextAfter: rawMarkdown.slice(
        anchor.end,
        anchor.end + CONTEXT_LENGTH
      ),
      mermaidLabel: {
        text: labelText,
        occurrence,
        selectionStart,
        selectionEnd,
      },
    };
  }

  // Find source-offset ancestors for start and end
  const startEl = findSourceElement(range.startContainer);
  const endEl = findSourceElement(range.endContainer);

  if (!startEl) return null;
  if (
    startEl.classList.contains('mermaid-diagram') ||
    endEl?.classList.contains('mermaid-diagram')
  ) {
    return null;
  }

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
    startBlockEnd,
    sourceMapOptionsForElement(startEl)
  );

  const endTextOffset = getTextOffsetInElement(
    effectiveEndEl,
    range.endContainer,
    range.endOffset
  );
  // When the selection ends at offset 0 of a different block, the user
  // hasn't selected any content from that block (common when dragging to
  // select a full line — the browser anchors at the start of the next
  // element). Use the block boundary directly to avoid bleeding into it.
  const endSourceOffset = (endTextOffset === 0 && startEl !== effectiveEndEl)
    ? endBlockStart
    : textOffsetToSourceOffset(
        endTextOffset,
        rawMarkdown,
        endBlockStart,
        endBlockEnd,
        sourceMapOptionsForElement(effectiveEndEl)
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
