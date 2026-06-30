import React from 'react';
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
              className={`comment-quote${annotation.embedLabel ? ' embed-quote' : ''}`}
              onClick={onQuoteClick}
              title="Scroll to highlight"
            >
              {annotation.embedLabel
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

/**
 * Lightweight inline markdown renderer for comment text.
 * Supports: fenced code blocks, inline code, bold, italic, line breaks.
 */
export function renderCommentMarkdown(text: string): string {
  // Escape HTML first
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Extract fenced code blocks before processing inline markdown
  const blocks: string[] = [];
  const withPlaceholders = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    blocks.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return `\x00BLOCK${blocks.length - 1}\x00`;
  });

  // Process inline markdown on non-code-block parts
  const rendered = withPlaceholders
    .split(/(\x00BLOCK\d+\x00)/)
    .map((part) => {
      const blockMatch = part.match(/^\x00BLOCK(\d+)\x00$/);
      if (blockMatch) return blocks[parseInt(blockMatch[1], 10)];
      // Inline: code, bold, italic, line breaks
      return esc(part)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    })
    .join('');

  return rendered;
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
