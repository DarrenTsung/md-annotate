import React, { useRef, useEffect } from 'react';
import type { Annotation } from '@shared/types.js';
import { applyHighlights } from '../lib/highlight.js';
import { useTextSelection } from '../hooks/useTextSelection.js';
import { SelectionPopover } from './SelectionPopover.js';
import type { SourceOffset } from '../lib/offsets.js';

interface MarkdownViewerProps {
  renderedHtml: string;
  rawMarkdown: string;
  annotations: Annotation[];
  onCreateAnnotation: (offset: SourceOffset, comment: string) => void;
  onHighlightClick: (annotationId: string) => void;
}

export function MarkdownViewer({
  renderedHtml,
  rawMarkdown,
  annotations,
  onCreateAnnotation,
  onHighlightClick,
}: MarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { selection, clearSelection } = useTextSelection(containerRef, rawMarkdown);

  // Apply highlights whenever annotations or HTML change
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const cleanup = applyHighlights(container, annotations);
    return cleanup;
  }, [annotations, renderedHtml]);

  // Handle clicks on highlights
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleClick(e: MouseEvent) {
      const mark = (e.target as HTMLElement).closest('mark[data-annotation-id]');
      if (mark) {
        const id = mark.getAttribute('data-annotation-id');
        if (id) onHighlightClick(id);
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
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
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
