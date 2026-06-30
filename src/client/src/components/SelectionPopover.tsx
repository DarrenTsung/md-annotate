import React, { useState, useRef, useLayoutEffect } from 'react';
import type { CommentKind } from '@shared/types.js';

interface SelectionPopoverProps {
  rect: DOMRect;
  selectedText: string;
  onSubmit: (comment: string, kind: CommentKind) => void;
  onCancel: () => void;
}

const POPOVER_HEIGHT = 200;
const POPOVER_WIDTH = 320;
const GAP = 8;

export function SelectionPopover({
  rect,
  selectedText,
  onSubmit,
  onCancel,
}: SelectionPopoverProps) {
  const [comment, setComment] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submit(kind: CommentKind) {
    if (comment.trim()) {
      onSubmit(comment.trim(), kind);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit('comment');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit('comment');
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  }

  const popoverRef = useRef<HTMLDivElement>(null);

  // Position below selection by default, above if not enough room below.
  // Use the popover's offset parent to convert viewport coords to local coords.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const parent = el.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect() ?? { top: 0, left: 0 };
    // The offset parent scrolls internally, so absolute coords are relative to
    // its content origin — add the scroll offset to convert from viewport coords.
    const scrollTop = parent?.scrollTop ?? 0;
    const scrollLeft = parent?.scrollLeft ?? 0;

    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < POPOVER_HEIGHT + GAP && rect.top > POPOVER_HEIGHT + GAP;

    const top = (placeAbove
      ? rect.top - parentRect.top - POPOVER_HEIGHT - GAP
      : rect.bottom - parentRect.top + GAP) + scrollTop;
    const left = Math.max(0, rect.left - parentRect.left + scrollLeft);

    setPos({ top, left: Math.min(left, (parent?.clientWidth ?? window.innerWidth) - POPOVER_WIDTH) });
  }, [rect]);

  // Focus the textarea once the popover is positioned and visible
  useLayoutEffect(() => {
    if (pos) {
      textareaRef.current?.focus();
    }
  }, [pos]);

  return (
    <div
      ref={popoverRef}
      className="selection-popover"
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        position: 'absolute',
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="popover-selected-text" title={selectedText}>
        "{selectedText.length > 50 ? selectedText.slice(0, 47) + '...' : selectedText}"
      </div>
      <form onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="popover-textarea"
          placeholder="Add a comment..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
        />
        <div className="popover-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!comment.trim()}
            onClick={() => submit('question')}
            title="Ask Claude to clarify without modifying the document"
          >
            Question
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!comment.trim()}
          >
            Comment <kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+↵</kbd>
          </button>
        </div>
      </form>
    </div>
  );
}
