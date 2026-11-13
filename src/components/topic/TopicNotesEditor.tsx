interface TopicNotesEditorProps {
  content: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  disabled?: boolean;
  notice?: string;
  message?: string;
}

export function TopicNotesEditor({
  content,
  onChange,
  onSave,
  saving,
  disabled = false,
  notice,
  message,
}: TopicNotesEditorProps) {
  return (
    <section className="border-border bg-bg-secondary/30 mb-16 rounded-2xl border p-8">
      <h2 className="text-3xl font-bold">My Notes</h2>
      <p className="text-text-secondary mt-3">Personal notes for this topic.</p>
      {notice && (
        <p role="status" className="text-text-secondary mt-3">
          {notice}
        </p>
      )}
      <textarea
        value={content}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={10}
        className="border-border bg-bg-card mt-6 w-full rounded-xl border p-4"
        placeholder="Write your notes here..."
      />
      <div className="mt-4 flex items-center gap-4">
        <button
          onClick={onSave}
          disabled={saving || disabled}
          className="bg-accent rounded-xl px-6 py-3 text-white"
        >
          {saving ? 'Saving...' : 'Save Note'}
        </button>
        {message && (
          <span role="status" className="text-text-secondary text-sm">
            {message}
          </span>
        )}
      </div>
    </section>
  );
}
