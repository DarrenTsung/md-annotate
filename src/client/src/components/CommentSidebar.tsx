import React from 'react';
import type { Annotation } from '@shared/types.js';
import { CommentThread } from './CommentThread.js';

interface CommentSidebarProps {
  annotations: Annotation[];
  activeAnnotationId: string | null;
  onSetActive: (id: string | null) => void;
  onReply: (annotationId: string, text: string) => void;
  onResolve: (annotationId: string) => void;
  onReopen: (annotationId: string) => void;
  onDelete: (annotationId: string) => void;
}

export function CommentSidebar({
  annotations,
  activeAnnotationId,
  onSetActive,
  onReply,
  onResolve,
  onReopen,
  onDelete,
}: CommentSidebarProps) {
  // Sort by position in document
  const sorted = [...annotations].sort(
    (a, b) => a.startOffset - b.startOffset
  );

  const openAnnotations = sorted.filter((a) => a.status === 'open');
  const resolvedAnnotations = sorted.filter((a) => a.status === 'resolved');

  return (
    <aside className="comment-sidebar">
      <div className="sidebar-header">
        <h2>
          Comments{' '}
          <span className="comment-count">
            {openAnnotations.length} open
            {resolvedAnnotations.length > 0 &&
              `, ${resolvedAnnotations.length} resolved`}
          </span>
        </h2>
      </div>

      <div className="sidebar-threads">
        {openAnnotations.map((annotation) => (
          <CommentThread
            key={annotation.id}
            annotation={annotation}
            isActive={activeAnnotationId === annotation.id}
            onActivate={() => onSetActive(activeAnnotationId === annotation.id ? null : annotation.id)}
            onReply={(text) => onReply(annotation.id, text)}
            onResolve={() => onResolve(annotation.id)}
            onReopen={() => onReopen(annotation.id)}
            onDelete={() => onDelete(annotation.id)}
          />
        ))}

        {resolvedAnnotations.length > 0 && (
          <>
            <div className="sidebar-divider">
              <span>Resolved</span>
            </div>
            {resolvedAnnotations.map((annotation) => (
              <CommentThread
                key={annotation.id}
                annotation={annotation}
                isActive={activeAnnotationId === annotation.id}
                onActivate={() => onSetActive(activeAnnotationId === annotation.id ? null : annotation.id)}
                onReply={(text) => onReply(annotation.id, text)}
                onResolve={() => onResolve(annotation.id)}
                onReopen={() => onReopen(annotation.id)}
                onDelete={() => onDelete(annotation.id)}
              />
            ))}
          </>
        )}

        {annotations.length === 0 && (
          <div className="sidebar-empty">
            <p>No comments yet</p>
            <p className="sidebar-hint">
              Select text in the document and add a comment
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
