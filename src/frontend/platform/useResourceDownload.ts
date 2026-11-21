/**
 * Resource-download telemetry for a surface that paints before its data lands.
 *
 * The startup screen uses it while the editor and Extension chunks arrive; the
 * chart-loading overlay uses it while worker chunks, textures, audio, and other
 * library resources load. The total is unknown at this layer, so callers keep
 * their own progress bar and show the observed bytes and speed beside it.
 */
import { useEffect, useState } from "react";
import {
  bootTransferRate,
  formatByteSize,
  formatTransferRate,
  isUiResource,
  summarizeBootProgress,
  type BootResourceTiming,
} from "../screens/startup/bootProgress.ts";

/** Formatted download status for a loading surface. */
export interface ResourceDownloadStatus {
  /** Total decompressed bytes observed after the surface mounted. */
  readonly downloaded: string;
  /** Observed transfer rate, or null when every file came from cache. */
  readonly speed: string | null;
}

/**
 * Watch resources that complete after the loading surface mounts.
 *
 * `enabled` is false while the surface hides or shows a failure; `resetKey`
 * starts a fresh count for the next operation. Resources already completed at
 * mount are recorded so the report covers only the current load.
 */
export function useResourceDownload(enabled: boolean, resetKey = 0): ResourceDownloadStatus | null {
  const [status, setStatus] = useState<ResourceDownloadStatus | null>(null);

  useEffect(() => {
    setStatus(null);
    if (
      !enabled ||
      typeof performance === "undefined" ||
      typeof PerformanceObserver === "undefined"
    ) {
      return undefined;
    }
    const seen = new Set<string>();
    for (const entry of performance.getEntriesByType("resource")) {
      seen.add(entry.name);
    }
    const timings = new Map<string, BootResourceTiming>();
    const startedAt = performance.now();
    let updateTimer = 0;
    let stopped = false;

    const update = () => {
      updateTimer = 0;
      if (stopped) {
        return;
      }
      const snapshot = summarizeBootProgress([...timings.values()], new Map(), isUiResource);
      if (snapshot.observedAssets === 0) {
        return;
      }
      const elapsed = Math.max(1, performance.now() - startedAt);
      setStatus({
        downloaded: formatByteSize(snapshot.loadedBytes),
        speed: formatTransferRate(bootTransferRate(snapshot, elapsed)),
      });
    };

    const schedule = () => {
      if (!updateTimer && !stopped) {
        updateTimer = window.setTimeout(update, 250);
      }
    };

    const add = (entry: PerformanceEntry) => {
      if (entry.entryType !== "resource") {
        return;
      }
      const timing = entry as PerformanceResourceTiming;
      if (
        seen.has(timing.name) ||
        !isUiResource(timing) ||
        !Number.isFinite(timing.responseEnd) ||
        timing.responseEnd <= 0
      ) {
        return;
      }
      seen.add(timing.name);
      timings.set(timing.name, {
        name: timing.name,
        initiatorType: timing.initiatorType,
        transferSize: timing.transferSize,
        encodedBodySize: timing.encodedBodySize,
        decodedBodySize: timing.decodedBodySize,
        startTime: timing.startTime,
        responseEnd: timing.responseEnd,
        responseStatus: (timing as PerformanceResourceTiming & { responseStatus?: number })
          .responseStatus,
      });
      schedule();
    };

    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          add(entry);
        }
        schedule();
      });
      observer.observe({ type: "resource", buffered: true });
    } catch {
      observer = null;
    }

    const collect = () => {
      for (const entry of performance.getEntriesByType("resource")) {
        add(entry);
      }
      schedule();
    };
    collect();
    const interval = window.setInterval(collect, 500);
    return () => {
      stopped = true;
      if (updateTimer) {
        window.clearTimeout(updateTimer);
      }
      window.clearInterval(interval);
      observer?.disconnect();
    };
  }, [enabled, resetKey]);

  return status;
}
