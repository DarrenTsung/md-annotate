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
      onClick={onActivate}
    >
      <div className="thread-header">
        <button
          className="thread-selected-text"
          onClick={scrollToHighlight}
          title="Scroll to highlight"
        >
          "{annotation.selectedText.length > 40
            ? annotation.selectedText.slice(0, 37) + '...'
            : annotation.selectedText}"
        </button>
        {annotation.working && (
          <span className="working-dot" title="Claude is working on this" />
        )}
        {annotation.sentToClaude && !annotation.working && (
          <span className="sent-badge" title="Sent to Claude">
            sent
          </span>
        )}
      </div>

      <div className="thread-comments">
        {annotation.comments.map((comment) => (
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
            </div>
            <div className="comment-text">{comment.text}</div>
          </div>
        ))}
      </div>

      {isActive && (
        <div className="thread-actions">
          {!showReply && (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowReply(true);
                }}
              >
                Reply
              </button>
              {isResolved ? (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReopen();
                  }}
                >
                  Reopen
                </button>
              ) : (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onResolve();
                  }}
                >
                  Resolve
                </button>
              )}
              <button
                className="btn btn-danger btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                Delete
              </button>
            </>
          )}
          {showReply && (
            <CommentForm
              onSubmit={handleReply}
              onCancel={() => setShowReply(false)}
              autoFocus
            />
          )}
        </div>
      )}
    </div>
  );
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
