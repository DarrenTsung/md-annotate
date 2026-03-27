import type { DiffHunk } from '@shared/types.js';

/**
 * Apply a diff overlay to rendered markdown. Adds `.diff-added` to blocks
 * with added content, and inserts `<del class="diff-removed">` elements for
 * removed text. Returns a cleanup function.
 */
export function applyDiffOverlay(
  container: HTMLElement,
  hunks: DiffHunk[],
): () => void {
  const addedElements: HTMLElement[] = [];
  const insertedElements: HTMLElement[] = [];

  const blockElements = Array.from(
    container.querySelectorAll('[data-source-start]')
  ) as HTMLElement[];

  for (const hunk of hunks) {
    if (hunk.type === 'added') {
      const hunkStart = hunk.newOffset;
      const hunkEnd = hunk.newOffset + hunk.value.length;

      // Collect all blocks that overlap with this hunk
      const matchingBlocks: HTMLElement[] = [];
      for (const block of blockElements) {
        const blockStart = parseInt(block.getAttribute('data-source-start')!, 10);
        const blockEnd = parseInt(block.getAttribute('data-source-end')!, 10);

        if (hunkStart < blockEnd && hunkEnd > blockStart) {
          matchingBlocks.push(block);
        }
      }

      // Only highlight the most specific blocks: skip any block that has
      // a descendant also in the matching set. This prevents highlighting
      // an entire <ol> when only one <li> was added.
      for (const block of matchingBlocks) {
        const hasMoreSpecificChild = matchingBlocks.some(
          other => other !== block && block.contains(other)
        );
        if (!hasMoreSpecificChild) {
          block.classList.add('diff-added');
          addedElements.push(block);
        }
      }
    } else if (hunk.type === 'removed') {
      // Find insertion point: the first block whose source-start >= hunk.newOffset,
      // or insert after the last block if none found
      let insertBefore: HTMLElement | null = null;
      for (const block of blockElements) {
        const blockStart = parseInt(block.getAttribute('data-source-start')!, 10);
        if (blockStart >= hunk.newOffset) {
          insertBefore = block;
          break;
        }
      }

      const del = document.createElement('del');
      del.className = 'diff-removed';
      del.textContent = hunk.value;

      if (insertBefore) {
        insertBefore.parentNode?.insertBefore(del, insertBefore);
      } else if (blockElements.length > 0) {
        // Append after the last block
        const lastBlock = blockElements[blockElements.length - 1];
        lastBlock.parentNode?.insertBefore(del, lastBlock.nextSibling);
      } else {
        container.appendChild(del);
      }
      insertedElements.push(del);
    }
  }

  return () => {
    for (const el of addedElements) {
      el.classList.remove('diff-added');
    }
    for (const el of insertedElements) {
      el.parentNode?.removeChild(el);
    }
  };
}
