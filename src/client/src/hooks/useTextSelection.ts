import { useState, useEffect, useCallback, useRef } from 'react';
import { selectionToSourceOffset, type SourceOffset } from '../lib/offsets.js';

interface SelectionState {
  offset: SourceOffset;
  rect: DOMRect;
}

interface UseTextSelectionResult {
  selection: SelectionState | null;
  clearSelection: () => void;
}

export function useTextSelection(
  containerRef: React.RefObject<HTMLElement | null>,
  rawMarkdown: string
): UseTextSelectionResult {
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const isSelecting = useRef(false);

  const clearSelection = useCallback(() => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleMouseDown() {
      isSelecting.current = true;
      setSelection(null);
    }

    function handleMouseUp() {
      if (!isSelecting.current) return;
      isSelecting.current = false;

      // Small delay to let the browser finalize the selection
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) {
          return;
        }

        // Make sure selection is within our container
        const range = sel.getRangeAt(0);
        if (!container!.contains(range.commonAncestorContainer)) {
          return;
        }

        const offset = selectionToSourceOffset(sel, rawMarkdown);
        if (!offset) return;

        const rect = range.getBoundingClientRect();
        setSelection({ offset, rect });
      });
    }

    // Handle clicks outside to dismiss
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (
        target.closest('.selection-popover') ||
        target.closest('.comment-sidebar')
      ) {
        return;
      }
      // Don't clear on mousedown in the markdown area (that starts a new selection)
      if (container!.contains(target)) return;
      setSelection(null);
    }

    container.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [containerRef, rawMarkdown, clearSelection]);

  return { selection, clearSelection };
}
