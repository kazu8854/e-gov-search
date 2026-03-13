"use client";

import { useState, useCallback, useRef } from "react";
import type { SearchStep, ConclusionData } from "@/types";

interface UseSearchReturn {
  steps: SearchStep[];
  conclusion: ConclusionData | null;
  isSearching: boolean;
  error: string | null;
  isConnected: boolean;
  search: (query: string) => void;
  reset: () => void;
}

// WebSocket URL はデプロイ後に環境変数 or 設定で渡す
function getWebSocketUrl(): string {
  if (typeof window !== "undefined") {
    // ページの meta タグ or グローバル変数から取得
    const meta = document.querySelector('meta[name="ws-url"]');
    if (meta) return meta.getAttribute("content") || "";
  }
  return process.env.NEXT_PUBLIC_WEBSOCKET_URL || "";
}

export function useSearch(): UseSearchReturn {
  const [steps, setSteps] = useState<SearchStep[]>([]);
  const [conclusion, setConclusion] = useState<ConclusionData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const reset = useCallback(() => {
    setSteps([]);
    setConclusion(null);
    setIsSearching(false);
    setError(null);
  }, []);

  const search = useCallback(
    (query: string) => {
      reset();
      setIsSearching(true);

      const wsUrl = getWebSocketUrl();

      // WebSocket未設定の場合はSSEフォールバック
      if (!wsUrl) {
        searchViaSSE(query, setSteps, setConclusion, setError, setIsSearching);
        return;
      }

      // WebSocket接続
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        // 検索リクエスト送信
        ws.send(
          JSON.stringify({
            action: "search",
            query,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.event) {
            case "step":
              setSteps((prev) => {
                const existing = prev.findIndex((s) => s.id === msg.data.id);
                if (existing >= 0) {
                  const updated = [...prev];
                  updated[existing] = msg.data;
                  return updated;
                }
                return [...prev, msg.data];
              });
              break;

            case "conclusion":
              setConclusion(msg.data);
              break;

            case "error":
              setError(msg.data.message);
              break;

            case "done":
              setIsSearching(false);
              ws.close();
              break;
          }
        } catch {
          // parse error, skip
        }
      };

      ws.onerror = () => {
        setError("WebSocket接続エラーが発生しました");
        setIsSearching(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
      };
    },
    [reset]
  );

  return { steps, conclusion, isSearching, error, isConnected, search, reset };
}

/**
 * SSEフォールバック（ローカル開発用 or WebSocket未設定時）
 */
function searchViaSSE(
  query: string,
  setSteps: React.Dispatch<React.SetStateAction<SearchStep[]>>,
  setConclusion: React.Dispatch<React.SetStateAction<ConclusionData | null>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>
) {
  fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
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
              }
            } catch {
              // skip
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
}

