import { useState, useEffect } from "react";
import { SEARCH_TIMER_INTERVAL_MS } from "./types.js";

export type SearchTimerAPI = {
  searchNow: number;
};

export function useSearchTimer(searchStartedAt: number | null): SearchTimerAPI {
  const [searchNow, setSearchNow] = useState(() => Date.now());

  useEffect(() => {
    if (!searchStartedAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setSearchNow(Date.now());
    }, SEARCH_TIMER_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [searchStartedAt]);

  return { searchNow };
}
