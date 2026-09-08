import React from 'react';
import MarkdownIt from 'markdown-it';
import type { Annotation } from '@shared/types.js';

interface ThreadCommentsProps {
  annotation: Annotation;
  /** Called when the quote (selected text) is clicked — typically scrolls to the highlight. */
  onQuoteClick?: () => void;
}

/**
 * Renders an annotation's comment list (with the leading quote and the
 * Claude typing indicator). Shared by the inline {@link CommentThread} and the
 * focused review view.
 */
export function ThreadComments({ annotation, onQuoteClick }: ThreadCommentsProps) {
  return (
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
            {comment.author === 'user' && comment.kind === 'question' && (
              <span
                className="comment-kind-badge"
                title="Question — Claude will reply without editing the document"
              >
                Question
              </span>
            )}
            <span className="comment-time">{formatTime(comment.createdAt)}</span>
            {index === 0 && annotation.working && (
              <span className="working-dot" title="Claude is working on this" />
            )}
            {index === 0 && !annotation.working && isPending(annotation) && (
              <span className="pending-dot" title="Waiting for Claude" />
            )}
          </div>
          {index === 0 && (
            <blockquote
              className={`comment-quote${annotation.embedLabel || annotation.mermaidLabel ? ' embed-quote' : ''}`}
              onClick={onQuoteClick}
              title="Scroll to highlight"
            >
              {annotation.mermaidLabel
                ? `◇ ${annotation.mermaidLabel.text.slice(
                    annotation.mermaidLabel.selectionStart,
                    annotation.mermaidLabel.selectionEnd
                  )}`
                : annotation.embedLabel
                ? `🧩 ${annotation.embedLabel}`
                : annotation.selectedText.length > 60
                ? annotation.selectedText.slice(0, 57) + '...'
                : annotation.selectedText}
            </blockquote>
          )}
          <div
            className="comment-text"
            dangerouslySetInnerHTML={{ __html: renderCommentMarkdown(comment.text) }}
          />
        </div>
      ))}
      {annotation.working && (
        <div className="thread-comment claude-comment typing-indicator" aria-label="Claude is typing">
          <div className="typing-dots">
            <span /><span /><span />
          </div>
        </div>
      )}
    </div>
  );
}

const commentMarkdown = new MarkdownIt('zero', { html: false, breaks: true })
  .enable(['table', 'fence', 'backticks', 'emphasis', 'escape', 'newline']);

commentMarkdown.renderer.rules.table_open = () =>
  '<div class="comment-table-scroll" tabindex="0" role="region" aria-label="Table"><table>\n';
commentMarkdown.renderer.rules.table_close = () => '</table></div>\n';

export function renderCommentMarkdown(text: string): string {
  return commentMarkdown.render(text);
}

export function isPending(annotation: Annotation): boolean {
  if (annotation.status !== 'open') return false;
  const last = annotation.comments[annotation.comments.length - 1];
  return !!last && last.author === 'user';
}

export function formatTime(iso: string): string {
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
