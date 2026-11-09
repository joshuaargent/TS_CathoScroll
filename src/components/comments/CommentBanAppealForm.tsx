'use client';

import { useState } from 'react';

export function CommentBanAppealForm() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitAppeal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/comment-ban/appeal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(result.error ?? 'Unable to submit your request.');
        return;
      }

      setSubmitted(true);
    } catch (submitError) {
      console.error('Unable to submit comment-ban appeal:', submitError);
      setError('Unable to submit your request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <article className="border-border rounded-2xl border p-6">
        <h2 className="text-xl font-bold">Request submitted</h2>
        <p className="text-text-secondary mt-2">
          Your appeal is private to admins and is now waiting for review.
        </p>
      </article>
    );
  }

  return (
    <form onSubmit={submitAppeal} className="border-border space-y-4 rounded-2xl border p-6">
      <label htmlFor="appeal-message" className="block font-semibold">
        Why should we review this restriction?
      </label>
      <textarea
        id="appeal-message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        minLength={20}
        maxLength={2000}
        rows={7}
        required
        className="border-border bg-background w-full resize-y rounded-xl border p-4"
        placeholder="Please provide enough context for an admin to review your request."
      />
      <div className="text-text-muted flex justify-between text-xs">
        <span>20–2,000 characters</span>
        <span>{message.length}/2000</span>
      </div>
      <p className="text-text-muted text-sm">
        Please be respectful. Submitting an appeal does not automatically remove the restriction.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isSubmitting || message.trim().length < 20}
        className="bg-accent rounded-xl px-5 py-3 font-medium text-white disabled:opacity-50"
      >
        {isSubmitting ? 'Submitting...' : 'Submit review request'}
      </button>
    </form>
  );
}
