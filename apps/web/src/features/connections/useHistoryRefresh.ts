import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { backgroundApi } from "../../lib/api";
import type { AppData } from "../../lib/data";
export function useHistoryRefresh(data: AppData) {
  const client = useQueryClient();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function step() {
      if (stopped) return;
      if (document.visibilityState !== "visible") {
        timer = setTimeout(() => void step(), 10000);
        return;
      }
      const pending = data.connections.filter(
        (connection) =>
          !connection.history.completedAt &&
          (!connection.history.error || !!connection.history.retryAt),
      );
      if (!pending.length) return;
      const ready = pending.filter(
        (connection) =>
          !connection.history.retryAt || Date.parse(connection.history.retryAt) <= Date.now(),
      );
      if (!ready.length) {
        const next = Math.min(
          ...pending.map((connection) => Date.parse(connection.history.retryAt!)),
        );
        timer = setTimeout(() => void step(), Math.max(1000, next - Date.now()));
        return;
      }
      try {
        await Promise.all(
          ready.map((connection) =>
            backgroundApi.connections.historyStep.mutate({ id: connection.id }),
          ),
        );
        if (!stopped) {
          const next = await backgroundApi.bootstrap.query();
          if (!stopped) client.setQueryData(["wealth"], next);
        }
      } catch {
        if (!stopped) timer = setTimeout(() => void step(), 15000);
      }
    }
    void step();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [data, client]);
}
