"use client";

import { Scale, ExternalLink, Lightbulb, BookOpen } from "lucide-react";
import type { ConclusionData } from "@/types";

interface ConclusionProps {
  data: ConclusionData;
}

export function Conclusion({ data }: ConclusionProps) {
  return (
    <div className="w-full max-w-3xl mx-auto mt-8 animate-fade-in">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-px flex-1 bg-[var(--card-border)]" />
        <span className="text-xs text-green-400 uppercase tracking-wider flex items-center gap-1">
          <Scale className="w-3 h-3" />
          調査結果
        </span>
        <div className="h-px flex-1 bg-[var(--card-border)]" />
      </div>

      {/* Summary */}
      <div className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-6 mb-4">
        <div className="prose prose-invert prose-sm max-w-none">
          <div
            className="text-sm leading-relaxed text-[var(--foreground)]"
            dangerouslySetInnerHTML={{
              __html: formatMarkdown(data.summary),
            }}
          />
        </div>
      </div>

      {/* Key Points */}
      {data.keyPoints && data.keyPoints.length > 0 && (
        <div className="rounded-2xl bg-[var(--card)] border border-yellow-500/20 p-5 mb-4">
          <h3 className="text-sm font-semibold text-yellow-400 flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4" />
            重要ポイント
          </h3>
          <ul className="space-y-2">
            {data.keyPoints.map((point, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-yellow-400 flex-shrink-0 mt-0.5">
                  {i + 1}.
                </span>
                <span className="text-[var(--foreground)]">{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Relevant Laws */}
      {data.relevantLaws && data.relevantLaws.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-blue-400 flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            関連法令・条文
          </h3>
          {data.relevantLaws.map((law) => (
            <div
              key={law.lawId}
              className="rounded-xl bg-[var(--card)] border border-[var(--card-border)] p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-[var(--foreground)]">
                  {law.lawTitle}
                </h4>
                <a
                  href={`https://laws.e-gov.go.jp/law/${law.lawId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1"
                >
                  e-Govで見る
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {law.articles && law.articles.length > 0 && (
                <div className="space-y-2">
                  {law.articles.map((article, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg bg-black/20 border border-[var(--card-border)]"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-[var(--accent)]">
                          {article.title || `第${article.number}条`}
                        </span>
                        {article.relevance && (
                          <span className="text-xs text-[var(--muted)]">
                            — {article.relevance}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--muted)] leading-relaxed">
                        {article.text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Disclaimer */}
      <div className="mt-6 p-3 rounded-lg bg-[var(--card)] border border-[var(--card-border)] text-center">
        <p className="text-xs text-[var(--muted)]">
          ⚠️
          この結果はAIによる情報提供であり、法的助言ではありません。正確な法的判断には専門家にご相談ください。
        </p>
      </div>
    </div>
  );
}

function formatMarkdown(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, '<code class="px-1 py-0.5 rounded bg-black/30">$1</code>')
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br />")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>");
}
