import type { DiffHunk } from '@shared/types.js';

/**
 * Unwrap list containers so removed content renders at the same level as the
 * surrounding document, with the number/bullet prepended as text.
 * e.g. `<ol start="2"><li><p><strong>X</strong></p></li></ol>`
 * becomes `<p>2. <strong>X</strong></p>`.
 */
function unwrapLists(container: HTMLElement): void {
  const list = container.querySelector('ol, ul');
  if (!list) return;

  const items = Array.from(list.querySelectorAll(':scope > li'));
  if (items.length === 0) return;

  const isOrdered = list.tagName === 'OL';
  const startNum = isOrdered ? (list as HTMLOListElement).start || 1 : 0;

  for (let i = 0; i < items.length; i++) {
    const li = items[i];
    const prefix = isOrdered ? `${startNum + i}. ` : '• ';
    // Prepend inside the first <p> if present, otherwise directly in <li>
    const firstP = li.querySelector(':scope > p');
    const target = firstP || li;
    target.insertBefore(document.createTextNode(prefix), target.firstChild);

    // Wrap each item in a <div> so multiple items render on separate lines
    // (tight lists have no <p> wrappers and would collapse into one line)
    const wrapper = document.createElement('div');
    while (li.firstChild) {
      wrapper.appendChild(li.firstChild);
    }
    list.parentNode?.insertBefore(wrapper, list);
  }
  list.remove();
}

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
  const hiddenElements: { el: HTMLElement; orig: string }[] = [];

  const blockElements = Array.from(
    container.querySelectorAll('[data-source-start]')
  ) as HTMLElement[];

  /** Find the most specific block(s) overlapping [start, end). */
  function findBlocks(start: number, end: number): HTMLElement[] {
    const matching: HTMLElement[] = [];
    for (const block of blockElements) {
      const bs = parseInt(block.getAttribute('data-source-start')!, 10);
      const be = parseInt(block.getAttribute('data-source-end')!, 10);
      if (start < be && end > bs) matching.push(block);
    }
    return matching.filter(
      (block) => !matching.some((o) => o !== block && block.contains(o))
    );
  }

  for (const hunk of hunks) {
    if (hunk.type === 'added') {
      for (const block of findBlocks(hunk.newOffset, hunk.newOffset + hunk.value.length)) {
        block.classList.add('diff-added');
        addedElements.push(block);
      }
    } else if (hunk.type === 'modified' && hunk.renderedValue) {
      // Replace the matching block(s) with the inline-diff rendered version.
      // Insert once before the first block, hide all matching blocks.
      const blocks = findBlocks(hunk.newOffset, hunk.newOffset + hunk.value.length);
      if (blocks.length === 0) continue;

      const tmp = document.createElement('div');
      tmp.innerHTML = hunk.renderedValue;
      unwrapLists(tmp);

      const firstBlock = blocks[0];

      if (blocks.length === 1) {
        // Single block: match the tag and extract inner content for clean merge.
        const inner = tmp.querySelector('p, li');
        const html = inner ? inner.innerHTML : tmp.innerHTML;

        const modified = document.createElement(firstBlock.tagName.toLowerCase());
        modified.className = 'diff-modified';
        for (const attr of firstBlock.attributes) {
          if (attr.name.startsWith('data-source')) {
            modified.setAttribute(attr.name, attr.value);
          }
        }
        modified.innerHTML = html;

        firstBlock.parentNode?.insertBefore(modified, firstBlock);
        insertedElements.push(modified);
      } else {
        // Multi-block: insert the full rendered content once.
        const modified = document.createElement('div');
        modified.className = 'diff-modified';
        modified.innerHTML = tmp.innerHTML.trim();

        firstBlock.parentNode?.insertBefore(modified, firstBlock);
        insertedElements.push(modified);
      }

      for (const block of blocks) {
        hiddenElements.push({ el: block, orig: block.style.display });
        block.style.display = 'none';
      }
    } else if (hunk.type === 'removed') {
      // Find insertion point: the first block whose source-start >= hunk.newOffset
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
      if (hunk.renderedValue) {
        const tmp = document.createElement('div');
        tmp.innerHTML = hunk.renderedValue;
        unwrapLists(tmp);
        del.innerHTML = tmp.innerHTML.trim();
      } else {
        del.textContent = hunk.value;
      }

      if (insertBefore) {
        insertBefore.parentNode?.insertBefore(del, insertBefore);
      } else if (blockElements.length > 0) {
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
    for (const { el, orig } of hiddenElements) {
      el.style.display = orig;
    }
  };
}
