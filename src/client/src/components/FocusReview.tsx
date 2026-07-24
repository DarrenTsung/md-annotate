import React, { useEffect, useMemo, useState } from 'react';
import type { Annotation, CommentKind } from '@shared/types.js';
import { CommentForm } from './CommentForm.js';
import { ThreadComments } from './ThreadComments.js';
import { lastActivityOf } from '../hooks/useViewedThreads.js';

interface FocusReviewProps {
  annotations: Annotation[];
  isUnread: (annotation: Annotation) => boolean;
  markViewed: (annotation: Annotation) => void;
  onSetActive: (id: string | null) => void;
  onReply: (annotationId: string, text: string, kind: CommentKind) => void;
  onResolve: (annotationId: string) => void;
  onReopen: (annotationId: string) => void;
  onDelete: (annotationId: string) => void;
  replyDrafts: Record<string, string>;
  onReplyDraftChange: (annotationId: string, text: string) => void;
}

function scrollToAnnotation(annotation: Annotation) {
  // Jump directly to the location rather than smooth-scrolling — over long
  // distances an animated scroll is disorienting.
  const opts: ScrollIntoViewOptions = { behavior: 'auto', block: 'center' };

  const mark = document.querySelector(
    `.annotation-highlight[data-annotation-id="${annotation.id}"]`
  );
  if (mark) {
    mark.scrollIntoView(opts);
    return;
  }

  // No highlight (e.g. a stale annotation whose anchor text was edited away).
  // Fall back to the rendered block that covers the source offset so the user
  // still lands near where the comment was made.
  const blocks = Array.from(
    document.querySelectorAll('[data-source-start]')
  ) as HTMLElement[];
  const containing = blocks.filter((el) => {
    const start = parseInt(el.getAttribute('data-source-start') || '0', 10);
    const end = parseInt(el.getAttribute('data-source-end') || '0', 10);
    // Overlap (not strict containment) so a slightly drifted anchor still hits.
    return annotation.startOffset < end && annotation.endOffset > start;
  });
  // Prefer the most specific (leaf) block among nested matches.
  const target =
    containing.find((el) => !containing.some((o) => o !== el && el.contains(o))) ??
    containing[0];
  target?.scrollIntoView(opts);
}

export function FocusReview({
  annotations,
  isUnread,
  markViewed,
  onSetActive,
  onReply,
  onResolve,
  onReopen,
  onDelete,
  replyDrafts,
  onReplyDraftChange,
}: FocusReviewProps) {
  // A stable, ordered queue of thread ids for this review session. Items are
  // kept once added (even after being viewed) so navigation and the "N of M"
  // counter don't jump around. New unread threads (e.g. fresh Claude replies)
  // are appended as they arrive.
  const [queue, setQueue] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setQueue((prev) => {
      const inQueue = new Set(prev);
      const additions = annotations
        .filter((a) => a.status !== 'deleted' && !inQueue.has(a.id) && isUnread(a))
        .sort((a, b) => lastActivityOf(a) - lastActivityOf(b))
        .map((a) => a.id);
      if (additions.length === 0) return prev;
      return [...prev, ...additions];
    });
  }, [annotations, isUnread]);

  // Live list of still-existing queued threads, in queue order.
  const items = useMemo(() => {
    const byId = new Map(annotations.map((a) => [a.id, a]));
    return queue
      .map((id) => byId.get(id))
      .filter((a): a is Annotation => !!a && a.status !== 'deleted');
  }, [queue, annotations]);

  const current = index < items.length ? items[index] : null;
  const currentId = current?.id ?? null;
  const currentActivity = current ? lastActivityOf(current) : 0;

  // Activate + scroll to the highlight whenever the displayed thread changes.
  useEffect(() => {
    if (!current) return;
    onSetActive(current.id);
    scrollToAnnotation(current);
    // Only re-run when the displayed thread changes, not on every annotation edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, onSetActive]);

  // Mark the displayed thread viewed — re-runs if its activity changes while open.
  useEffect(() => {
    if (current) markViewed(current);
  }, [currentId, currentActivity, current, markViewed]);

  function goNext() {
    setIndex((i) => Math.min(i + 1, items.length));
  }

  if (items.length === 0) {
    return (
      <div className="focus-review">
        <div className="focus-empty">
          <div className="focus-empty-icon">✓</div>
          <p>All caught up</p>
          <p className="sidebar-hint">No threads with unseen updates.</p>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="focus-review">
        <div className="focus-empty">
          <div className="focus-empty-icon">✓</div>
          <p>Reviewed all {items.length} {items.length === 1 ? 'thread' : 'threads'}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => setIndex(0)}>
            Review from start
          </button>
        </div>
      </div>
    );
  }

  const isResolved = current.status === 'resolved';
  const hasNext = index < items.length - 1;

  return (
    <div className="focus-review">
      <div className="focus-header">
        <span className="focus-progress">
          {index + 1} <span className="focus-progress-total">/ {items.length}</span>
        </span>
        <div className="focus-header-actions">
          <button
            className={`thread-icon-btn ${isResolved ? 'thread-unresolve' : 'thread-resolve'}`}
            title={isResolved ? 'Reopen' : 'Resolve'}
            onClick={() => (isResolved ? onReopen(current.id) : onResolve(current.id))}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
            </svg>
          </button>
          <button
            className="thread-icon-btn thread-delete"
            title="Delete"
            onClick={() => onDelete(current.id)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5" />
            </svg>
          </button>
        </div>
      </div>

      <div className="focus-body" key={current.id}>
        <div className={`comment-thread active ${isResolved ? 'resolved' : ''} ${current.stale ? 'stale' : ''} ${current.working ? 'working' : ''}`}>
          <ThreadComments annotation={current} onQuoteClick={() => scrollToAnnotation(current)} />
        </div>
      </div>

      <div className="focus-footer">
        <CommentForm
          key={current.id}
          onSubmit={(text, kind) => onReply(current.id, text, kind)}
          value={replyDrafts[current.id] ?? ''}
          onChange={(text) => onReplyDraftChange(current.id, text)}
        />
        <button
          className="btn btn-primary btn-sm focus-next"
          onClick={goNext}
          title={hasNext ? 'Next thread with updates' : 'Finish review'}
        >
          {hasNext ? 'Next →' : 'Done'}
        </button>
      </div>
    </div>
  );
}
