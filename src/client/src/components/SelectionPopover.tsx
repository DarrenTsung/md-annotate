import React, { useState, useRef, useEffect } from 'react';

interface SelectionPopoverProps {
  rect: DOMRect;
  selectedText: string;
  onSubmit: (comment: string) => void;
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

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (comment.trim()) {
      onSubmit(comment.trim());
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (comment.trim()) {
        onSubmit(comment.trim());
      }
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  }

  // Position below selection by default, above if not enough room below
  const spaceBelow = window.innerHeight - rect.bottom;
  const placeAbove = spaceBelow < POPOVER_HEIGHT + GAP && rect.top > POPOVER_HEIGHT + GAP;
  const top = placeAbove
    ? rect.top + window.scrollY - POPOVER_HEIGHT - GAP
    : rect.bottom + window.scrollY + GAP;
  const left = Math.max(16, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 16));

  return (
    <div
      className="selection-popover"
      style={{ top, left, position: 'absolute' }}
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
