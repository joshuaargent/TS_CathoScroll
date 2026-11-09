'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';

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
      <div className="border-border rounded-2xl border p-6">
        <h2 className="text-xl font-bold">Request submitted</h2>
        <p className="text-text-secondary mt-2">
          Your appeal is private to admins and is now waiting for review.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submitAppeal} className="space-y-5">
      <div className="border-border rounded-2xl border p-6">
        <Textarea
          id="appeal-message"
          label="Why should we review this restriction?"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          minLength={20}
          maxLength={2000}
          rows={7}
          required
          hint="Be specific and respectful. Your message is only visible to admins."
          placeholder="Please provide enough context for an admin to review your request."
        />
        <div className="text-text-muted mt-2 flex justify-between text-xs">
          <span>20–2,000 characters</span>
          <span>{message.length}/2000</span>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <p className="text-text-muted text-sm">
        Submitting an appeal does not automatically remove the restriction.
      </p>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        isLoading={isSubmitting}
        disabled={message.trim().length < 20}
      >
        {isSubmitting ? 'Submitting...' : 'Submit review request'}
      </Button>
    </form>
  );
}
