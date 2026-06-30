import React, { useState, useRef, useEffect } from 'react';
import type { CommentKind } from '@shared/types.js';

interface CommentFormProps {
  onSubmit: (text: string, kind: CommentKind) => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  // Optional controlled draft — persists across remounts when the parent
  // owns the state (e.g. when an LLM update reorders or restages the thread).
  value?: string;
  onChange?: (text: string) => void;
}

export function CommentForm({
  onSubmit,
  onCancel,
  placeholder = 'Reply...',
  autoFocus = false,
  value,
  onChange,
}: CommentFormProps) {
  const [internalText, setInternalText] = useState('');
  const text = value ?? internalText;
  const setText = (next: string) => {
    if (onChange) onChange(next);
    else setInternalText(next);
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) {
      // Don't steal focus from another textarea/input the user is typing in
      const active = document.activeElement;
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
        return;
      }
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      // Place cursor at end so a restored draft is ready to keep typing into.
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }
  }, [autoFocus]);

  function submit(kind: CommentKind) {
    if (text.trim()) {
      onSubmit(text.trim(), kind);
      setText('');
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    submit('comment');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit('comment');
    }
    if (e.key === 'Escape' && onCancel) {
      onCancel();
    }
  }

  return (
    <form className="comment-form" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={textareaRef}
        className="comment-textarea"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
      />
      <div className="comment-form-actions">
        {onCancel && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!text.trim()}
          onClick={() => submit('question')}
          title="Ask Claude to clarify without modifying the document"
        >
          Question
        </button>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={!text.trim()}
        >
          Comment
        </button>
      </div>
    </form>
  );
}
