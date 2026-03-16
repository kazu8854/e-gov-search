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

/**
 * AppSync Event API の設定を取得
 * デプロイ後に環境変数で設定する
 */
function getAppSyncConfig() {
  return {
    httpEndpoint: process.env.NEXT_PUBLIC_APPSYNC_HTTP_ENDPOINT || "",
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
  const [isConnected, setIsConnected] = useState(false);
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
    setIsConnected(false);
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
      searchViaAppSync(
        query,
        config,
        setSteps,
        setConclusion,
        setError,
        setIsSearching,
        setIsConnected,
        wsRef
      );
    },
    [reset]
  );

  return { steps, conclusion, isSearching, error, isConnected, search, reset };
}

/**
 * AppSync Event API WebSocket を使った検索
 * 
 * フロー:
 * 1. REST API POST /search → searchId を取得
 * 2. AppSync Event API WebSocket で /search/{searchId} チャネルをsubscribe
 * 3. Step Functions が各Phase完了時にAppSyncにpublish → ブラウザにリアルタイム配信
 */
async function searchViaAppSync(
  query: string,
  config: { httpEndpoint: string; realtimeEndpoint: string; apiKey: string; restApiUrl: string },
  setSteps: React.Dispatch<React.SetStateAction<SearchStep[]>>,
  setConclusion: React.Dispatch<React.SetStateAction<ConclusionData | null>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>,
  setIsConnected: React.Dispatch<React.SetStateAction<boolean>>,
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
    // AppSync Events WebSocket の接続URL構築
    // 参考: https://docs.aws.amazon.com/appsync/latest/eventapi/websocket-workflow.html
    const authHeader = btoa(JSON.stringify({
      host: new URL(`https://${config.realtimeEndpoint}`).hostname,
      "x-api-key": config.apiKey,
    }));
    
    const wsUrl = `wss://${config.realtimeEndpoint}/event/realtime?header=${authHeader}&payload=e30=`;

    const ws = new WebSocket(wsUrl, ["aws-appsync-event-ws", "header-" + authHeader]);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // connection_init を送信
      ws.send(JSON.stringify({ type: "connection_init" }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "connection_ack":
            // 接続確認完了 → チャネルをsubscribe
            ws.send(
              JSON.stringify({
                type: "subscribe",
                id: crypto.randomUUID(),
                channel: `/search/${searchId}`,
                authorization: {
                  "x-api-key": config.apiKey,
                  host: new URL(`https://${config.realtimeEndpoint}`).hostname,
                },
              })
            );
            break;

          case "subscribe_success":
            // サブスクライブ成功
            console.log("Subscribed to channel:", `/search/${searchId}`);
            break;

          case "data":
            // イベント受信
            handleAppSyncEvent(
              msg.event,
              setSteps,
              setConclusion,
              setError,
              setIsSearching,
              ws
            );
            break;

          case "ka":
            // keep-alive, ignore
            break;

          case "error":
          case "subscribe_error":
          case "connection_error":
            console.error("AppSync WS error:", msg);
            setError("リアルタイム接続でエラーが発生しました");
            setIsSearching(false);
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
  } catch (e) {
    setError(e instanceof Error ? e.message : "検索の開始に失敗しました");
    setIsSearching(false);
  }
}

function handleAppSyncEvent(
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
          const existing = prev.findIndex((s) => s.id === payload.data.id);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = payload.data;
            return updated;
          }
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
  } catch {
    // parse error
  }
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
                    const existing = prev.findIndex((s) => s.id === data.id);
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

