import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Annotation } from '@shared/types.js';
import { CommentThread } from './CommentThread.js';

const RECENTLY_RESOLVED_MS = 5000;

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
  // Track recently resolved annotations so they stay expanded briefly
  const [recentlyResolved, setRecentlyResolved] = useState<Set<string>>(new Set());
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const prev = prevStatusRef.current;
    for (const a of annotations) {
      const wasOpen = prev.get(a.id) === 'open';
      if (wasOpen && a.status === 'resolved') {
        setRecentlyResolved((s) => new Set(s).add(a.id));
        const timer = setTimeout(() => {
          setRecentlyResolved((s) => {
            const next = new Set(s);
            next.delete(a.id);
            return next;
          });
          timersRef.current.delete(a.id);
        }, RECENTLY_RESOLVED_MS);
        timersRef.current.set(a.id, timer);
      }
      prev.set(a.id, a.status);
    }
    return () => {
      for (const t of timersRef.current.values()) clearTimeout(t);
    };
  }, [annotations]);

  // Sort by position in document
  const sorted = [...annotations].sort(
    (a, b) => a.startOffset - b.startOffset
  );

  const openAnnotations = sorted.filter((a) => a.status === 'open');
  // Resolved: newest first (most recently resolved at top)
  const resolvedAnnotations = [...annotations]
    .filter((a) => a.status === 'resolved')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

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
          <ResolvedSection
            resolvedAnnotations={resolvedAnnotations}
            activeAnnotationId={activeAnnotationId}
            recentlyResolved={recentlyResolved}
            onSetActive={onSetActive}
            onReply={onReply}
            onResolve={onResolve}
            onReopen={onReopen}
            onDelete={onDelete}
          />
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

function ResolvedSection({
  resolvedAnnotations,
  activeAnnotationId,
  recentlyResolved,
  onSetActive,
  onReply,
  onResolve,
  onReopen,
  onDelete,
}: {
  resolvedAnnotations: Annotation[];
  activeAnnotationId: string | null;
  recentlyResolved: Set<string>;
  onSetActive: (id: string | null) => void;
  onReply: (annotationId: string, text: string) => void;
  onResolve: (annotationId: string) => void;
  onReopen: (annotationId: string) => void;
  onDelete: (annotationId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  function handleDeleteAll() {
    for (const a of resolvedAnnotations) {
      onDelete(a.id);
    }
    setConfirming(false);
  }

  return (
    <>
      <div className="sidebar-divider">
        <span>Resolved</span>
        {confirming ? (
          <span className="delete-resolved-confirm">
            <button
              className="btn btn-danger btn-xs"
              onClick={() => handleDeleteAll()}
            >
              Delete {resolvedAnnotations.length}
            </button>
            <button
              className="btn btn-secondary btn-xs"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="delete-resolved-btn"
            title="Delete all resolved"
            onClick={() => setConfirming(true)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"/>
            </svg>
          </button>
        )}
      </div>
      {resolvedAnnotations.map((annotation) => (
        <CommentThread
          key={annotation.id}
          annotation={annotation}
          isActive={activeAnnotationId === annotation.id}
          forceExpanded={recentlyResolved.has(annotation.id)}
          onActivate={() => onSetActive(activeAnnotationId === annotation.id ? null : annotation.id)}
          onReply={(text) => onReply(annotation.id, text)}
          onResolve={() => onResolve(annotation.id)}
          onReopen={() => onReopen(annotation.id)}
          onDelete={() => onDelete(annotation.id)}
        />
      ))}
    </>
  );
}
