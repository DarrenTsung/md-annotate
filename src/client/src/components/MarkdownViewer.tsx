import React, { useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import type { Annotation } from '@shared/types.js';
import { applyHighlights, applyPendingHighlight } from '../lib/highlight.js';
import { useTextSelection } from '../hooks/useTextSelection.js';
import { SelectionPopover } from './SelectionPopover.js';
import type { SourceOffset } from '../lib/offsets.js';

interface MarkdownViewerProps {
  renderedHtml: string;
  rawMarkdown: string;
  annotations: Annotation[];
  activeAnnotationId: string | null;
  onCreateAnnotation: (offset: SourceOffset, comment: string) => void;
  onHighlightClick: (annotationId: string) => void;
  onActionButtonClick: (action: string, sourceStart: number, sourceEnd: number, selectedText: string) => void;
}

export function MarkdownViewer({
  renderedHtml,
  rawMarkdown,
  annotations,
  activeAnnotationId,
  onCreateAnnotation,
  onHighlightClick,
  onActionButtonClick,
}: MarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { selection, clearSelection } = useTextSelection(containerRef, rawMarkdown);

  // Memoize so React's reference check skips innerHTML re-assignment
  // when only activeAnnotationId changes (not renderedHtml)
  const htmlPayload = useMemo(() => ({ __html: renderedHtml }), [renderedHtml]);

  // Apply highlights only when annotations or HTML change — NOT activeAnnotationId.
  // useLayoutEffect to avoid flash between cleanup and re-apply.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scrollY = window.scrollY;
    const cleanup = applyHighlights(container, annotations);
    window.scrollTo(0, scrollY);
    return cleanup;
  }, [annotations, renderedHtml]);

  // Toggle active class on marks — separate from highlight injection so
  // clicking a comment never tears down / re-creates the mark elements.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear any previous active
    container.querySelectorAll('mark.active').forEach((m) => m.classList.remove('active'));

    if (activeAnnotationId) {
      container
        .querySelectorAll(`mark[data-annotation-id="${activeAnnotationId}"]`)
        .forEach((m) => m.classList.add('active'));
    }
  }, [activeAnnotationId, annotations, renderedHtml]);

  // Scroll to and blink the active highlight when a comment is selected
  useEffect(() => {
    if (!activeAnnotationId) return;

    const mark = document.querySelector(
      `mark[data-annotation-id="${activeAnnotationId}"]`
    );
    if (!mark) return;

    // Only scroll if the highlight isn't already visible
    const markRect = mark.getBoundingClientRect();
    if (markRect.top < 0 || markRect.bottom > window.innerHeight) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    mark.classList.add('highlight-blink');

    const timer = setTimeout(() => {
      mark.classList.remove('highlight-blink');
    }, 1500);

    return () => {
      clearTimeout(timer);
      mark.classList.remove('highlight-blink');
    };
  }, [activeAnnotationId]);

  // Highlight the pending selection while the popover is open
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !selection) return;

    const scrollY = window.scrollY;
    const cleanup = applyPendingHighlight(
      container,
      selection.offset.startOffset,
      selection.offset.endOffset,
      selection.offset.selectedText
    );
    // DOM manipulation can shift scroll; restore it
    window.scrollTo(0, scrollY);
    return cleanup;
  }, [selection]);

  // Cmd+C copies the selected text and dismisses the popover
  useEffect(() => {
    if (!selection) return;

    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        navigator.clipboard.writeText(selection!.offset.selectedText);
        clearSelection();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selection, clearSelection]);

  // Handle clicks on highlights and anchor links
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;

      // Action button clicks
      const actionBtn = target.closest('.action-btn') as HTMLElement | null;
      if (actionBtn) {
        e.preventDefault();
        const action = actionBtn.getAttribute('data-action');
        const block = actionBtn.closest('[data-source-start]') as HTMLElement | null;
        if (action && block) {
          const sourceStart = parseInt(block.getAttribute('data-source-start')!, 10);
          const sourceEnd = parseInt(block.getAttribute('data-source-end')!, 10);
          // Use rendered text content (excluding action button labels) so the
          // highlight code can find an exact match instead of falling back to
          // offset-ratio positioning which bleeds into adjacent elements.
          const clone = block.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('.action-buttons').forEach((el) => el.remove());
          const selectedText = (clone.textContent || '').trim();
          onActionButtonClick(action, sourceStart, sourceEnd, selectedText);
        }
        return;
      }

      // Annotation highlight clicks
      const mark = target.closest('mark[data-annotation-id]');
      if (mark) {
        const id = mark.getAttribute('data-annotation-id');
        if (id) onHighlightClick(id);
        return;
      }

      // Anchor link clicks — smooth scroll instead of navigating
      const link = target.closest('a[href^="#"]') as HTMLAnchorElement | null;
      if (link) {
        e.preventDefault();
        const id = decodeURIComponent(link.getAttribute('href')!.slice(1));
        const heading = document.getElementById(id);
        if (heading) {
          heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [onHighlightClick, onActionButtonClick]);

  function handleSubmitComment(comment: string) {
    if (selection) {
      const scrollY = window.scrollY;
      onCreateAnnotation(selection.offset, comment);
      clearSelection();
      // Restore scroll after React re-renders to prevent viewport jump
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollY);
      });
    }
  }

  return (
    <div className="markdown-viewer-container">
      <article
        ref={containerRef}
        className="markdown-viewer"
        dangerouslySetInnerHTML={htmlPayload}
      />
      {selection && (
        <SelectionPopover
          rect={selection.rect}
          selectedText={selection.offset.selectedText}
          onSubmit={handleSubmitComment}
          onCancel={clearSelection}
        />
      )}
    </div>
  );
}
