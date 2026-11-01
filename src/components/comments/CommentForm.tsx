'use client';

import { useState } from 'react';

interface CommentFormProps {
  initialValue?: string;

  submitLabel?: string;

  onSubmit: (content: string) => Promise<void>;

  onCancel?: () => void;
}

export function CommentForm({
  initialValue = '',
  submitLabel = 'Post Comment',
  onSubmit,
  onCancel,
}: CommentFormProps) {
  const [content, setContent] = useState(initialValue);

  const [submitting, setSubmitting] = useState(false);

  const trimmedContent = content.trim();

  async function handleSubmit() {
    if (!trimmedContent) {
      return;
    }

    setSubmitting(true);

    try {
      await onSubmit(trimmedContent);

      setContent('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-border rounded-2xl border p-6">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={2000}
        rows={5}
        autoFocus={!!onCancel}
        placeholder={onCancel ? 'Write a reply...' : 'Share your thoughts on this topic...'}
        className="border-border bg-background focus:border-accent focus:ring-accent/20 w-full resize-none rounded-xl border p-4 transition-colors outline-none"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            void handleSubmit();
          }
        }}
      />

      <div className="text-text-muted mt-2 flex items-center justify-between text-xs">
        <span>Ctrl/Cmd + Enter to submit</span>

        <span>
          {content.length}
          /2000
        </span>
      </div>

      <div className="mt-4 flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="border-border hover:bg-bg-secondary rounded-xl border px-4 py-2 transition-colors"
          >
            Cancel
          </button>
        )}

        <button
          type="button"
          disabled={submitting || !trimmedContent}
          onClick={handleSubmit}
          className="bg-accent hover:bg-accent/90 rounded-xl px-4 py-2 text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Posting...' : submitLabel}
        </button>
      </div>
    </div>
  );
}
