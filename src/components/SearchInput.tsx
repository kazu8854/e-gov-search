"use client";

import { useState } from "react";
import { Search, Loader2, Sparkles } from "lucide-react";

interface SearchInputProps {
  onSearch: (query: string) => void;
  isSearching: boolean;
}

const EXAMPLE_QUERIES = [
  "残業代が未払いの場合、法的にどうなる？",
  "隣の家の木の枝が敷地に入ってきた場合の対処法",
  "ネット上の誹謗中傷に対する法的措置",
  "賃貸住宅の敷金返還について",
  "副業は法律で禁止されている？",
  "自転車の交通ルールについて",
];

export function SearchInput({ onSearch, isSearching }: SearchInputProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isSearching) {
      onSearch(query.trim());
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-3 mb-3">
          <Sparkles className="w-8 h-8 text-blue-400" />
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            法令探索AI
          </h1>
        </div>
        <p className="text-[var(--muted)] text-sm">
          自然言語で質問すると、AIがe-Gov法令APIを使って関連法令を探索します
        </p>
      </div>

      <form onSubmit={handleSubmit} className="relative mb-6">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="法律について知りたいことを入力してください..."
            className="w-full px-5 py-4 pr-14 rounded-2xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-all text-lg"
            disabled={isSearching}
          />
          <button
            type="submit"
            disabled={!query.trim() || isSearching}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-xl bg-[var(--accent)] text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {isSearching ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Search className="w-5 h-5" />
            )}
          </button>
        </div>
      </form>

      {!isSearching && (
        <div className="flex flex-wrap gap-2 justify-center">
          {EXAMPLE_QUERIES.map((example) => (
            <button
              key={example}
              onClick={() => {
                setQuery(example);
                onSearch(example);
              }}
              className="px-3 py-1.5 rounded-full text-xs bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-all"
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
