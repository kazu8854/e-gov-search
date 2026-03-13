"use client";

import {
  Brain,
  Search,
  BookOpen,
  Link2,
  BarChart3,
  FileText,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import type { SearchStep, StepType } from "@/types";

const STEP_ICONS: Record<StepType, React.ReactNode> = {
  thinking: <Brain className="w-4 h-4" />,
  searching: <Search className="w-4 h-4" />,
  reading: <BookOpen className="w-4 h-4" />,
  following: <Link2 className="w-4 h-4" />,
  analyzing: <BarChart3 className="w-4 h-4" />,
  summarizing: <FileText className="w-4 h-4" />,
};

const STEP_COLORS: Record<StepType, string> = {
  thinking: "text-purple-400",
  searching: "text-blue-400",
  reading: "text-cyan-400",
  following: "text-orange-400",
  analyzing: "text-yellow-400",
  summarizing: "text-green-400",
};

interface SearchProcessProps {
  steps: SearchStep[];
}

export function SearchProcess({ steps }: SearchProcessProps) {
  if (steps.length === 0) return null;

  return (
    <div className="w-full max-w-3xl mx-auto mt-8">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-px flex-1 bg-[var(--card-border)]" />
        <span className="text-xs text-[var(--muted)] uppercase tracking-wider">
          探索プロセス
        </span>
        <div className="h-px flex-1 bg-[var(--card-border)]" />
      </div>

      <div className="space-y-2">
        {steps.map((step, index) => (
          <StepCard key={step.id} step={step} index={index} />
        ))}
      </div>
    </div>
  );
}

function StepCard({ step, index }: { step: SearchStep; index: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasDetails = step.detail || (step.results && step.results.length > 0);

  return (
    <div
      className="animate-fade-in"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div
        className={`
          rounded-xl border transition-all
          ${step.status === "active"
            ? "bg-[var(--card)] border-[var(--accent)] shadow-lg shadow-blue-500/5"
            : step.status === "error"
            ? "bg-[var(--card)] border-red-500/30"
            : "bg-[var(--card)] border-[var(--card-border)]"
          }
        `}
      >
        {/* Header */}
        <button
          onClick={() => hasDetails && setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left"
        >
          {/* Status icon */}
          <div
            className={`flex-shrink-0 ${
              step.status === "active"
                ? STEP_COLORS[step.type]
                : step.status === "error"
                ? "text-red-400"
                : "text-green-400"
            }`}
          >
            {step.status === "active" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : step.status === "error" ? (
              <AlertCircle className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
          </div>

          {/* Type icon */}
          <div className={`flex-shrink-0 ${STEP_COLORS[step.type]}`}>
            {STEP_ICONS[step.type]}
          </div>

          {/* Label */}
          <span
            className={`flex-1 text-sm ${
              step.status === "active"
                ? "text-[var(--foreground)]"
                : "text-[var(--muted)]"
            }`}
          >
            {step.label}
          </span>

          {/* Expand icon */}
          {hasDetails && (
            <div className="flex-shrink-0 text-[var(--muted)]">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </div>
          )}
        </button>

        {/* Details (expandable) */}
        {isExpanded && hasDetails && (
          <div className="px-4 pb-3 animate-expand">
            {step.detail && (
              <p className="text-xs text-[var(--muted)] mb-2 whitespace-pre-wrap pl-11">
                {step.detail}
              </p>
            )}
            {step.results && step.results.length > 0 && (
              <div className="pl-11 space-y-1">
                {step.results.map((result, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-xs p-2 rounded-lg bg-black/20"
                  >
                    <span className="text-[var(--accent)] flex-shrink-0">•</span>
                    <div>
                      <span className="text-[var(--foreground)]">
                        {result.lawTitle}
                      </span>
                      {result.articleNumber && (
                        <span className="text-[var(--muted)]">
                          {" "}
                          第{result.articleNumber}条
                        </span>
                      )}
                      {result.relevance && (
                        <span className="text-[var(--muted)] block mt-0.5">
                          → {result.relevance}
                        </span>
                      )}
                      {result.excerpt && (
                        <span className="text-[var(--muted)] block mt-0.5 italic">
                          「{result.excerpt}」
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
