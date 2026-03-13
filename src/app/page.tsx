"use client";

import { SearchInput } from "@/components/SearchInput";
import { SearchProcess } from "@/components/SearchProcess";
import { Conclusion } from "@/components/Conclusion";
import { useSearch } from "@/lib/use-search";
import { AlertCircle, RotateCcw, Wifi, WifiOff } from "lucide-react";

export default function Home() {
  const { steps, conclusion, isSearching, error, isConnected, search, reset } =
    useSearch();

  return (
    <main className="min-h-screen px-4 py-12 max-w-4xl mx-auto">
      <SearchInput onSearch={search} isSearching={isSearching} />

      {/* 接続状態表示 */}
      {process.env.NEXT_PUBLIC_WEBSOCKET_URL && (
        <div className="w-full max-w-3xl mx-auto mt-2 flex justify-center">
          <span
            className={`text-xs flex items-center gap-1 ${
              isConnected ? "text-green-400" : "text-[var(--muted)]"
            }`}
          >
            {isConnected ? (
              <>
                <Wifi className="w-3 h-3" /> WebSocket接続中
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3" /> 待機中
              </>
            )}
          </span>
        </div>
      )}

      {error && (
        <div className="w-full max-w-3xl mx-auto mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={reset}
              className="mt-2 text-xs text-[var(--muted)] hover:text-[var(--foreground)] flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              やり直す
            </button>
          </div>
        </div>
      )}

      <SearchProcess steps={steps} />

      {conclusion && <Conclusion data={conclusion} />}

      {(steps.length > 0 || conclusion) && !isSearching && (
        <div className="w-full max-w-3xl mx-auto mt-8 text-center">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg text-sm text-[var(--muted)] hover:text-[var(--foreground)] bg-[var(--card)] border border-[var(--card-border)] hover:border-[var(--accent)] transition-all flex items-center gap-2 mx-auto"
          >
            <RotateCcw className="w-4 h-4" />
            新しい質問をする
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-16 text-center">
        <p className="text-xs text-[var(--muted)]">
          Powered by{" "}
          <a
            href="https://laws.e-gov.go.jp/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            e-Gov 法令API v2
          </a>
          {" "}+{" "}
          <a
            href="https://openai.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            OpenAI
          </a>
          {" "}+{" "}
          <span className="text-[var(--muted)]">
            AWS Step Functions
          </span>
        </p>
      </footer>
    </main>
  );
}
