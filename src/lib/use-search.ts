"use client";

import { useState, useCallback, useRef } from "react";
import type { SearchStep, ConclusionData } from "@/types";

interface UseSearchReturn {
  steps: SearchStep[];
  conclusion: ConclusionData | null;
  isSearching: boolean;
  error: string | null;
  search: (query: string) => void;
  reset: () => void;
}

export function useSearch(): UseSearchReturn {
  const [steps, setSteps] = useState<SearchStep[]>([]);
  const [conclusion, setConclusion] = useState<ConclusionData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setSteps([]);
    setConclusion(null);
    setIsSearching(false);
    setError(null);
  }, []);

  const search = useCallback((query: string) => {
    reset();
    setIsSearching(true);

    const controller = new AbortController();
    abortRef.current = controller;

    fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "検索に失敗しました");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("Stream not available");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ") && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6));
                switch (currentEvent) {
                  case "step":
                    setSteps((prev) => {
                      const existing = prev.findIndex(
                        (s) => s.id === data.id
                      );
                      if (existing >= 0) {
                        const updated = [...prev];
                        updated[existing] = data;
                        return updated;
                      }
                      return [...prev, data];
                    });
                    break;
                  case "conclusion":
                    setConclusion(data);
                    break;
                  case "error":
                    setError(data.message);
                    break;
                  case "done":
                    break;
                }
              } catch {
                // JSON parse error, skip
              }
              currentEvent = "";
            }
          }
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e.message);
        }
      })
      .finally(() => {
        setIsSearching(false);
      });
  }, [reset]);

  return { steps, conclusion, isSearching, error, search, reset };
}
