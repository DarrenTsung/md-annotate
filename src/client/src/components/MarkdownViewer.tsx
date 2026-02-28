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
}

export function MarkdownViewer({
  renderedHtml,
  rawMarkdown,
  annotations,
  activeAnnotationId,
  onCreateAnnotation,
  onHighlightClick,
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

    const cleanup = applyHighlights(container, annotations);
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

    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !selection) return;

    return applyPendingHighlight(
      container,
      selection.offset.startOffset,
      selection.offset.endOffset,
      selection.offset.selectedText
    );
  }, [selection]);

  // Handle clicks on highlights and anchor links
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;

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
  }, [onHighlightClick]);

  function handleSubmitComment(comment: string) {
    if (selection) {
      onCreateAnnotation(selection.offset, comment);
      clearSelection();
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
