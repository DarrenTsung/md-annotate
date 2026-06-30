import React, { useState } from 'react';
import type { Annotation, CommentKind } from '@shared/types.js';
import { CommentForm } from './CommentForm.js';
import { ThreadComments, formatTime } from './ThreadComments.js';

interface CommentThreadProps {
  annotation: Annotation;
  isActive: boolean;
  forceExpanded?: boolean;
  onActivate: () => void;
  onReply: (text: string, kind: CommentKind) => void;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onManualCollapse?: () => void;
  replyDraft: string;
  onReplyDraftChange: (text: string) => void;
}

export function CommentThread({
  annotation,
  isActive,
  forceExpanded,
  onActivate,
  onReply,
  onResolve,
  onReopen,
  onDelete,
  onManualCollapse,
  replyDraft,
  onReplyDraftChange,
}: CommentThreadProps) {
  const [showReply, setShowReply] = useState(false);

  function handleReply(text: string, kind: CommentKind) {
    onReply(text, kind);
    setShowReply(false);
  }

  function scrollToHighlight() {
    const mark = document.querySelector(
      `mark[data-annotation-id="${annotation.id}"]`
    );
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    onActivate();
  }

  const isResolved = annotation.status === 'resolved';
  const collapsed = isResolved && !isActive && !forceExpanded;

  if (collapsed) {
    const quote = annotation.selectedText.length > 40
      ? annotation.selectedText.slice(0, 37) + '...'
      : annotation.selectedText;
    const firstUserComment = annotation.comments.find((c) => c.author === 'user');
    const firstMessage = firstUserComment?.text ?? '';
    const truncatedMessage = firstMessage.length > 80
      ? firstMessage.slice(0, 77) + '...'
      : firstMessage;
    const lastComment = annotation.comments[annotation.comments.length - 1];
    const updatedAt = lastComment?.createdAt ?? annotation.comments[0]?.createdAt;
    return (
      <div
        className="comment-thread resolved collapsed"
        data-annotation-id={annotation.id}
        tabIndex={0}
        onClick={onActivate}
      >
        <div className="collapsed-top">
          <svg className="collapsed-check" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.5"/>
          </svg>
          <span className="collapsed-quote">{quote}</span>
          <span className="collapsed-meta">
            {annotation.comments.length} {annotation.comments.length === 1 ? 'msg' : 'msgs'}
            {updatedAt && <> · {formatTime(updatedAt)}</>}
          </span>
        </div>
        {truncatedMessage && (
          <div className="collapsed-message">{truncatedMessage}</div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`comment-thread ${isActive ? 'active' : ''} ${isResolved ? 'resolved' : ''} ${annotation.stale ? 'stale' : ''} ${annotation.working ? 'working' : ''}`}
      data-annotation-id={annotation.id}
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && isActive && !showReply) {
          e.preventDefault();
          setShowReply(true);
        }
      }}
    >
      <div className="thread-icons">
        {isResolved && onManualCollapse && (
          <button
            className="thread-icon-btn thread-collapse"
            title="Collapse"
            onClick={(e) => {
              e.stopPropagation();
              onManualCollapse();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6.5L8 10.5L12 6.5"/>
            </svg>
          </button>
        )}
        <button
          className={`thread-icon-btn ${isResolved ? 'thread-unresolve' : 'thread-resolve'}`}
          title={isResolved ? 'Reopen' : 'Resolve'}
          onClick={(e) => {
            e.stopPropagation();
            isResolved ? onReopen() : onResolve();
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.5"/>
          </svg>
        </button>
        <button
          className="thread-icon-btn thread-delete"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"/>
          </svg>
        </button>
      </div>
      <ThreadComments annotation={annotation} onQuoteClick={scrollToHighlight} />

      {isActive && (
        <div className="thread-actions">
          <CommentForm
            onSubmit={handleReply}
            onCancel={() => setShowReply(false)}
            autoFocus
            value={replyDraft}
            onChange={onReplyDraftChange}
          />
        </div>
      )}
    </div>
  );
}

