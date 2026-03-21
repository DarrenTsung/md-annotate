import React, { useState, useRef, useEffect } from 'react';

interface CommentFormProps {
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function CommentForm({
  onSubmit,
  onCancel,
  placeholder = 'Reply...',
  autoFocus = false,
}: CommentFormProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (text.trim()) {
      onSubmit(text.trim());
      setText('');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (text.trim()) {
        onSubmit(text.trim());
        setText('');
      }
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
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={!text.trim()}
        >
          Reply
        </button>
      </div>
    </form>
  );
}
