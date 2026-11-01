'use client';

import { Search, X } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchInput({ value, onChange }: SearchInputProps) {
  return (
    <div className="relative">
      <Search className="text-text-muted absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2" />

      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search topics, catechism, or scripture..."
        aria-label="Search CathoScroll"
        className="border-border bg-bg-card focus:border-accent w-full rounded-2xl border py-4 pr-12 pl-12 text-lg transition-colors outline-none"
      />

      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="text-text-muted hover:bg-bg-secondary hover:text-text-primary absolute top-1/2 right-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
