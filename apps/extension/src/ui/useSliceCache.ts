import { useRef, useCallback } from "react";
import type { LogSliceResponse } from "@server-log-console/shared";
import { MAX_PREVIEW_CACHE_ENTRIES, MAX_SLICE_CACHE_ENTRIES } from "./types.js";
import { setLimitedMapEntry } from "./app-utils.js";
import { getPreviewCacheKey, getSliceCacheKey } from "./utils.js";

export type SliceCacheAPI = {
  sliceCacheRef: React.MutableRefObject<Map<string, LogSliceResponse>>;
  sliceWarmRef: React.MutableRefObject<Set<string>>;
  previewCacheRef: React.MutableRefObject<Map<string, { offset: number; content: string }>>;
  cacheSlicePayload: (payload: LogSliceResponse, requestedOffset: number, targetLength: number) => void;
  getCachedSlice: (targetFilePath: string, targetOffset: number, targetLength: number) => LogSliceResponse | null;
  warmSlice: (targetFilePath: string, targetOffset: number, targetLength: number, fetchLogSlice: (path: string, offset: number, length: number) => Promise<LogSliceResponse>) => Promise<LogSliceResponse | null>;
  warmNeighborSlices: (targetFilePath: string, payload: LogSliceResponse, targetLength: number, fetchLogSlice: (path: string, offset: number, length: number) => Promise<LogSliceResponse>) => void;
};

function formatPreviewSnippet(content: string): string {
  const lines = content.split("\n").filter(Boolean);
  if (!lines.length) return "";
  const first = lines[0].slice(0, 120);
  const last = lines[lines.length - 1].slice(0, 120);
  return lines.length === 1 ? first : `${first} … ${last}`;
}

export function useSliceCache(): SliceCacheAPI {
  const sliceCacheRef = useRef(new Map<string, LogSliceResponse>());
  const sliceWarmRef = useRef(new Set<string>());
  const previewCacheRef = useRef(new Map<string, { offset: number; content: string }>());

  const cacheSlicePayload = useCallback(
    (payload: LogSliceResponse, requestedOffset: number, targetLength: number) => {
      const requestedKey = getSliceCacheKey(payload.filePath, requestedOffset, targetLength);
      const actualKey = getSliceCacheKey(payload.filePath, payload.actualOffset, targetLength);
      setLimitedMapEntry(sliceCacheRef.current, requestedKey, payload, MAX_SLICE_CACHE_ENTRIES);
      setLimitedMapEntry(sliceCacheRef.current, actualKey, payload, MAX_SLICE_CACHE_ENTRIES);

      const previewContent = formatPreviewSnippet(payload.content) || "这一段没有完整日志行。";
      const requestedPreviewKey = getPreviewCacheKey(payload.filePath, requestedOffset);
      const actualPreviewKey = getPreviewCacheKey(payload.filePath, payload.actualOffset);
      setLimitedMapEntry(previewCacheRef.current, requestedPreviewKey, {
        offset: payload.actualOffset,
        content: previewContent
      }, MAX_PREVIEW_CACHE_ENTRIES);
      setLimitedMapEntry(previewCacheRef.current, actualPreviewKey, {
        offset: payload.actualOffset,
        content: previewContent
      }, MAX_PREVIEW_CACHE_ENTRIES);
    },
    []
  );

  const getCachedSlice = useCallback(
    (targetFilePath: string, targetOffset: number, targetLength: number) => {
      return sliceCacheRef.current.get(getSliceCacheKey(targetFilePath, targetOffset, targetLength)) ?? null;
    },
    []
  );

  const warmSlice = useCallback(
    async (targetFilePath: string, targetOffset: number, targetLength: number, fetchLogSlice: (path: string, offset: number, length: number) => Promise<LogSliceResponse>) => {
      const cacheKey = getSliceCacheKey(targetFilePath, targetOffset, targetLength);
      if (sliceCacheRef.current.has(cacheKey) || sliceWarmRef.current.has(cacheKey)) {
        return sliceCacheRef.current.get(cacheKey) ?? null;
      }

      sliceWarmRef.current.add(cacheKey);
      try {
        const payload = await fetchLogSlice(targetFilePath, targetOffset, targetLength);
        cacheSlicePayload(payload, targetOffset, targetLength);
        return payload;
      } finally {
        sliceWarmRef.current.delete(cacheKey);
      }
    },
    [cacheSlicePayload]
  );

  const warmNeighborSlices = useCallback(
    (targetFilePath: string, payload: LogSliceResponse, targetLength: number, fetchLogSlice: (path: string, offset: number, length: number) => Promise<LogSliceResponse>) => {
      const nextOffsets: number[] = [];

      if (!payload.isStart) {
        nextOffsets.push(Math.max(0, payload.actualOffset - targetLength));
      }
      if (!payload.isEnd) {
        nextOffsets.push(payload.nextOffset);
      }

      nextOffsets.forEach((offset) => {
        void warmSlice(targetFilePath, offset, targetLength, fetchLogSlice);
      });
    },
    [warmSlice]
  );

  return {
    sliceCacheRef,
    sliceWarmRef,
    previewCacheRef,
    cacheSlicePayload,
    getCachedSlice,
    warmSlice,
    warmNeighborSlices,
  };
}
