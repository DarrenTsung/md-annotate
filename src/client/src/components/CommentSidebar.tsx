import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
} from 'react';
import type { Annotation } from '@shared/types.js';
import { CommentThread } from './CommentThread.js';
import { FocusReview } from './FocusReview.js';
import { useViewedThreads } from '../hooks/useViewedThreads.js';
import {
  applyResolvedThreadTransitions,
  findResolvedThreadTransitions,
} from '../lib/resolvedThreads.js';

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
  const clickAwayArmedIdRef = useRef<string | null>(null);
  const previousActiveAnnotationIdRef = useRef<string | null>(
    activeAnnotationId
  );

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
  const [expandedResolved, setExpandedResolved] = useState<Set<string>>(
    new Set()
  );
  const prevStatusRef = useRef<Map<string, Annotation['status']>>(new Map());

  const clearExpandedResolved = useCallback((id: string) => {
    setExpandedResolved((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    const transitions = findResolvedThreadTransitions(
      prevStatusRef.current,
      annotations
    );
    const armedId = clickAwayArmedIdRef.current;
    if (
      armedId &&
      (transitions.newlyResolved.has(armedId) ||
        transitions.noLongerResolved.has(armedId))
    ) {
      clickAwayArmedIdRef.current = null;
    }
    prevStatusRef.current = transitions.currentStatuses;
    setExpandedResolved((current) =>
      applyResolvedThreadTransitions(current, transitions)
    );
  }, [annotations]);

  useEffect(() => {
    if (
      previousActiveAnnotationIdRef.current !== activeAnnotationId &&
      clickAwayArmedIdRef.current !== activeAnnotationId
    ) {
      clickAwayArmedIdRef.current = null;
    }
    previousActiveAnnotationIdRef.current = activeAnnotationId;
  }, [activeAnnotationId]);

  const handleManualCollapse = useCallback(
    (id: string) => {
      if (clickAwayArmedIdRef.current === id) {
        clickAwayArmedIdRef.current = null;
      }
      clearExpandedResolved(id);
      if (activeAnnotationId === id) onSetActive(null);
    },
    [activeAnnotationId, clearExpandedResolved, onSetActive]
  );

  const handleThreadActivate = useCallback(
    (annotation: Annotation) => {
      clickAwayArmedIdRef.current = annotation.id;
      if (activeAnnotationId === annotation.id) {
        if (annotation.status !== 'resolved') onSetActive(null);
        return;
      }
      onSetActive(annotation.id);
    },
    [activeAnnotationId, onSetActive]
  );

  const handleProgrammaticSetActive = useCallback(
    (id: string | null) => {
      clickAwayArmedIdRef.current = null;
      onSetActive(id);
    },
    [onSetActive]
  );

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const highlightId = target
        .closest('.annotation-highlight[data-annotation-id]')
        ?.getAttribute('data-annotation-id');
      if (highlightId) clickAwayArmedIdRef.current = highlightId;
    }

    function handleMouseDown(event: MouseEvent) {
      if (event.button !== 0) return;
      const target = event.target;
      if (tab !== 'all' || !activeAnnotationId) return;
      const annotationId = activeAnnotationId;
      if (
        target instanceof Element &&
        target.closest('.comment-thread')?.getAttribute('data-annotation-id') ===
          annotationId
      ) {
        clickAwayArmedIdRef.current = annotationId;
        return;
      }
      const active = annotations.find((a) => a.id === annotationId);
      if (
        active?.status !== 'resolved' ||
        clickAwayArmedIdRef.current !== annotationId
      ) {
        return;
      }
      handleManualCollapse(annotationId);
    }

    document.addEventListener('click', handleClick);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [tab, activeAnnotationId, annotations, handleManualCollapse]);

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
          onSetActive={handleProgrammaticSetActive}
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
            onActivate={() => handleThreadActivate(annotation)}
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
            expandedResolved={expandedResolved}
            onThreadActivate={handleThreadActivate}
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
  expandedResolved,
  onThreadActivate,
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
  expandedResolved: Set<string>;
  onThreadActivate: (annotation: Annotation) => void;
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
          forceExpanded={expandedResolved.has(annotation.id)}
          onActivate={() => onThreadActivate(annotation)}
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
