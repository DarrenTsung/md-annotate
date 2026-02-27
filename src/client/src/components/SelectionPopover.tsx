import React, { useState, useRef, useEffect } from 'react';

interface SelectionPopoverProps {
  rect: DOMRect;
  selectedText: string;
  onSubmit: (comment: string) => void;
  onCancel: () => void;
}

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

  // Position the popover below the selection, clamped to viewport
  const top = Math.min(rect.bottom + 8, window.innerHeight - 220);
  const left = Math.max(16, Math.min(rect.left, window.innerWidth - 336));

  return (
    <div
      className="selection-popover"
      style={{ top, left, position: 'fixed' }}
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
