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

/**
 * AppSync Event API の設定を取得（CDKデプロイ後に環境変数で設定）
 */
function getAppSyncConfig() {
  return {
    realtimeEndpoint: process.env.NEXT_PUBLIC_APPSYNC_REALTIME_ENDPOINT || "",
    apiKey: process.env.NEXT_PUBLIC_APPSYNC_API_KEY || "",
    restApiUrl: process.env.NEXT_PUBLIC_REST_API_URL || "",
  };
}

export function useSearch(): UseSearchReturn {
  const [steps, setSteps] = useState<SearchStep[]>([]);
  const [conclusion, setConclusion] = useState<ConclusionData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setSteps([]);
    setConclusion(null);
    setIsSearching(false);
    setError(null);
  }, []);

  const search = useCallback(
    (query: string) => {
      reset();
      setIsSearching(true);

      const config = getAppSyncConfig();

      // AppSync未設定の場合はSSEフォールバック（ローカル開発用）
      if (!config.realtimeEndpoint || !config.apiKey || !config.restApiUrl) {
        searchViaSSE(query, setSteps, setConclusion, setError, setIsSearching);
        return;
      }

      // AppSync Event API WebSocket で探索
      searchViaAppSync(query, config, setSteps, setConclusion, setError, setIsSearching, wsRef);
    },
    [reset]
  );

  return { steps, conclusion, isSearching, error, search, reset };
}

/**
 * AppSync Event API WebSocket を使った検索
 */
async function searchViaAppSync(
  query: string,
  config: { realtimeEndpoint: string; apiKey: string; restApiUrl: string },
  setSteps: React.Dispatch<React.SetStateAction<SearchStep[]>>,
  setConclusion: React.Dispatch<React.SetStateAction<ConclusionData | null>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>,
  wsRef: React.MutableRefObject<WebSocket | null>
) {
  try {
    // Step 1: REST API で検索開始、searchId を取得
    const startRes = await fetch(`${config.restApiUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!startRes.ok) {
      const data = await startRes.json();
      throw new Error(data.error || "検索の開始に失敗しました");
    }

    const { searchId } = await startRes.json();

    // Step 2: AppSync Event API WebSocket に接続
    const host = new URL(`https://${config.realtimeEndpoint}`).hostname;
    const authHeader = btoa(JSON.stringify({
      host,
      "x-api-key": config.apiKey,
    }));

    const wsUrl = `wss://${config.realtimeEndpoint}/event/realtime?header=${authHeader}&payload=e30=`;
    const ws = new WebSocket(wsUrl, ["aws-appsync-event-ws", "header-" + authHeader]);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "connection_init" }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "connection_ack":
            ws.send(JSON.stringify({
              type: "subscribe",
              id: crypto.randomUUID(),
              channel: `/search/${searchId}`,
              authorization: { "x-api-key": config.apiKey, host },
            }));
            break;
          case "data":
            handleEvent(msg.event, setSteps, setConclusion, setError, setIsSearching, ws);
            break;
          case "error":
          case "subscribe_error":
            setError("リアルタイム接続でエラーが発生しました");
            setIsSearching(false);
            break;
        }
      } catch { /* skip */ }
    };

    ws.onerror = () => {
      setError("WebSocket接続エラーが発生しました");
      setIsSearching(false);
    };

    ws.onclose = () => { wsRef.current = null; };
  } catch (e) {
    setError(e instanceof Error ? e.message : "検索の開始に失敗しました");
    setIsSearching(false);
  }
}

function handleEvent(
  eventPayload: string,
  setSteps: React.Dispatch<React.SetStateAction<SearchStep[]>>,
  setConclusion: React.Dispatch<React.SetStateAction<ConclusionData | null>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>,
  ws: WebSocket
) {
  try {
    const payload = typeof eventPayload === "string" ? JSON.parse(eventPayload) : eventPayload;
    switch (payload.event) {
      case "step":
        setSteps((prev) => {
          const idx = prev.findIndex((s) => s.id === payload.data.id);
          if (idx >= 0) { const u = [...prev]; u[idx] = payload.data; return u; }
          return [...prev, payload.data];
        });
        break;
      case "conclusion":
        setConclusion(payload.data);
        break;
      case "error":
        setError(payload.data.message);
        break;
      case "done":
        setIsSearching(false);
        ws.close();
        break;
    }
  } catch { /* skip */ }
}

/**
 * SSEフォールバック（ローカル開発用 or AppSync未設定時）
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
                    const idx = prev.findIndex((s) => s.id === data.id);
                    if (idx >= 0) { const u = [...prev]; u[idx] = data; return u; }
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
            } catch { /* skip */ }
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

