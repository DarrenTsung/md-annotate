import React, { useState } from 'react';
import type { Annotation } from '@shared/types.js';
import { CommentForm } from './CommentForm.js';

interface CommentThreadProps {
  annotation: Annotation;
  isActive: boolean;
  onActivate: () => void;
  onReply: (text: string) => void;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
}

export function CommentThread({
  annotation,
  isActive,
  onActivate,
  onReply,
  onResolve,
  onReopen,
  onDelete,
}: CommentThreadProps) {
  const [showReply, setShowReply] = useState(false);

  function handleReply(text: string) {
    onReply(text);
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

  return (
    <div
      className={`comment-thread ${isActive ? 'active' : ''} ${isResolved ? 'resolved' : ''} ${annotation.working ? 'working' : ''}`}
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
        <button
          className={`thread-icon-btn ${isResolved ? 'thread-unresolve' : 'thread-resolve'}`}
          title={isResolved ? 'Reopen' : 'Resolve'}
          onClick={(e) => {
            e.stopPropagation();
            isResolved ? onReopen() : onResolve();
          }}
        >
          {isResolved ? (
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8.5L6.5 11.5L12.5 4.5"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0"/>
            </svg>
          )}
        </button>
        <button
          className="thread-icon-btn thread-delete"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"/>
          </svg>
        </button>
      </div>
      <div className="thread-comments">
        {annotation.comments.map((comment, index) => (
          <div
            key={comment.id}
            className={`thread-comment ${comment.author === 'claude' ? 'claude-comment' : 'user-comment'}`}
          >
            <div className="comment-header">
              <span className="comment-author">
                {comment.author === 'claude' ? 'Claude' : 'You'}
              </span>
              <span className="comment-time">
                {formatTime(comment.createdAt)}
              </span>
              {index === 0 && annotation.working && (
                <span className="working-dot" title="Claude is working on this" />
              )}
              {index === 0 && !annotation.working && isPending(annotation) && (
                <span className="pending-dot" title="Waiting for Claude" />
              )}
            </div>
            {index === 0 && (
              <blockquote
                className="comment-quote"
                onClick={scrollToHighlight}
                title="Scroll to highlight"
              >
                {annotation.selectedText.length > 60
                  ? annotation.selectedText.slice(0, 57) + '...'
                  : annotation.selectedText}
              </blockquote>
            )}
            <div className="comment-text">{comment.text}</div>
          </div>
        ))}
      </div>

      {isActive && (
        <div className="thread-actions">
          <CommentForm
            onSubmit={handleReply}
            onCancel={() => setShowReply(false)}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

function isPending(annotation: Annotation): boolean {
  if (annotation.status !== 'open') return false;
  const last = annotation.comments[annotation.comments.length - 1];
  return !!last && last.author === 'user';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
}
