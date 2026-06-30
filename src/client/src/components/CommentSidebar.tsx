import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Annotation } from '@shared/types.js';
import { CommentThread } from './CommentThread.js';
import { FocusReview } from './FocusReview.js';
import { useViewedThreads } from '../hooks/useViewedThreads.js';

const RECENTLY_RESOLVED_MS = 5000;

type SidebarTab = 'all' | 'review';

interface CommentSidebarProps {
  filePath: string;
  annotations: Annotation[];
  activeAnnotationId: string | null;
  onSetActive: (id: string | null) => void;
  onReply: (annotationId: string, text: string, kind: import('@shared/types.js').CommentKind) => void;
  onResolve: (annotationId: string) => void;
  onReopen: (annotationId: string) => void;
  onDelete: (annotationId: string) => void;
  replyDrafts: Record<string, string>;
  onReplyDraftChange: (annotationId: string, text: string) => void;
}

export function CommentSidebar({
  filePath,
  annotations,
  activeAnnotationId,
  onSetActive,
  onReply,
  onResolve,
  onReopen,
  onDelete,
  replyDrafts,
  onReplyDraftChange,
}: CommentSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>('all');
  const { isUnread, markViewed } = useViewedThreads(filePath);

  // Mark a thread viewed whenever the user opens it (in either tab). This is
  // what drops it out of the unread review queue.
  useEffect(() => {
    if (!activeAnnotationId) return;
    const active = annotations.find((a) => a.id === activeAnnotationId);
    if (active) markViewed(active);
  }, [activeAnnotationId, annotations, markViewed]);

  const unreadCount = annotations.filter(
    (a) => a.status !== 'deleted' && isUnread(a)
  ).length;
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

  const handleManualCollapse = useCallback(
    (id: string) => {
      const timer = timersRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(id);
      }
      setRecentlyResolved((s) => {
        if (!s.has(id)) return s;
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      if (activeAnnotationId === id) onSetActive(null);
    },
    [activeAnnotationId, onSetActive]
  );

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
        <div className="sidebar-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'all'}
            className={`sidebar-tab ${tab === 'all' ? 'active' : ''}`}
            onClick={() => setTab('all')}
          >
            Comments{' '}
            <span className="comment-count">
              {openAnnotations.length} open
              {resolvedAnnotations.length > 0 &&
                `, ${resolvedAnnotations.length} resolved`}
            </span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'review'}
            className={`sidebar-tab ${tab === 'review' ? 'active' : ''}`}
            onClick={() => setTab('review')}
          >
            Review
            {unreadCount > 0 && <span className="unread-badge">{unreadCount}</span>}
          </button>
        </div>
      </div>

      {tab === 'review' ? (
        <FocusReview
          annotations={annotations}
          isUnread={isUnread}
          markViewed={markViewed}
          onSetActive={onSetActive}
          onReply={onReply}
          onResolve={onResolve}
          onReopen={onReopen}
          onDelete={onDelete}
          replyDrafts={replyDrafts}
          onReplyDraftChange={onReplyDraftChange}
        />
      ) : (
      <div className="sidebar-threads">
        {openAnnotations.map((annotation) => (
          <CommentThread
            key={annotation.id}
            annotation={annotation}
            isActive={activeAnnotationId === annotation.id}
            onActivate={() => onSetActive(activeAnnotationId === annotation.id ? null : annotation.id)}
            onReply={(text, kind) => onReply(annotation.id, text, kind)}
            onResolve={() => onResolve(annotation.id)}
            onReopen={() => onReopen(annotation.id)}
            onDelete={() => onDelete(annotation.id)}
            replyDraft={replyDrafts[annotation.id] ?? ''}
            onReplyDraftChange={(text) => onReplyDraftChange(annotation.id, text)}
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
            onManualCollapse={handleManualCollapse}
            replyDrafts={replyDrafts}
            onReplyDraftChange={onReplyDraftChange}
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
      )}
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
  onManualCollapse,
  replyDrafts,
  onReplyDraftChange,
}: {
  resolvedAnnotations: Annotation[];
  activeAnnotationId: string | null;
  recentlyResolved: Set<string>;
  onSetActive: (id: string | null) => void;
  onReply: (annotationId: string, text: string, kind: import('@shared/types.js').CommentKind) => void;
  onResolve: (annotationId: string) => void;
  onReopen: (annotationId: string) => void;
  onDelete: (annotationId: string) => void;
  onManualCollapse: (annotationId: string) => void;
  replyDrafts: Record<string, string>;
  onReplyDraftChange: (annotationId: string, text: string) => void;
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
          onReply={(text, kind) => onReply(annotation.id, text, kind)}
          onResolve={() => onResolve(annotation.id)}
          onReopen={() => onReopen(annotation.id)}
          onDelete={() => onDelete(annotation.id)}
          onManualCollapse={() => onManualCollapse(annotation.id)}
          replyDraft={replyDrafts[annotation.id] ?? ''}
          onReplyDraftChange={(text) => onReplyDraftChange(annotation.id, text)}
        />
      ))}
    </>
  );
}
