/**
 * Boot-time runtime for the inline startup splash.
 *
 * The splash is static HTML so it can paint before the application stylesheet
 * and module graph arrive. This module upgrades that card: it selects the stored
 * language, observes Resource Timing for the first-paint payload, and reports
 * transferred bytes and the observed rate. `main.tsx` waits for the deferred
 * stylesheet, and `App` switches it on and dismisses the splash from its first
 * layout effect, so the React startup screen takes over without a blank frame.
 *
 * Every entry point tolerates a host without a DOM; the module itself has no
 * import-time side effects.
 */
import type { BootCopy, BootCopyDocument } from "./bootSplashMarkup.ts";
import {
  bootAssetIndex,
  bootTransferRate,
  formatByteSize,
  formatTransferRate,
  summarizeBootProgress,
  type BootProgressSnapshot,
  type BootResourceTiming,
} from "./bootProgress.ts";

const SPLASH_SELECTOR = ".redux-boot";
const STYLE_SELECTOR = "style[data-redux-boot-style]";
const COPY_META = "redux-boot-copy";
const ASSET_META = "redux-boot-assets";
const STYLE_LINK_SELECTOR = "link[data-redux-boot-styles]";
const BOOT_STYLE_TIMEOUT_MS = 12_000;
const UPDATE_THROTTLE_MS = 250;
const SPEED_REFRESH_MS = 500;
/** localStorage key holding the mirrored preference document. */
const PREFERENCE_MIRROR_KEY = "redux:preferences";

/** A language the splash can speak. Kept here so the boot chunk stays standalone. */
type BootLanguage = "en" | "zh";

/** The `lang` attribute written by the boot pass; the app repeats this later. */
const BOOT_HTML_LANG: Record<BootLanguage, string> = { en: "en", zh: "zh-CN" };

/** Dismissal flag shared by every copy of this module the bundler may emit. */
const bootGlobal = globalThis as typeof globalThis & { __reduxBootDismissed?: boolean };

/** Stops the installed observer and timers. */
let stopRuntime: (() => void) | null = null;
/** Cached stylesheet readiness so every caller observes the same load. */
let stylesReady: Promise<void> | null = null;

/** The clock used by the transfer-rate window. */
function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Normalize one locale tag to a language the splash can speak. */
function normalizeBootLanguage(value: string): BootLanguage | null {
  const language = value.trim().toLowerCase().split(/[-_]/u)[0];
  return language === "en" || language === "zh" ? language : null;
}

/** The first supported language among the machine's preferences, else English. */
function detectBootLanguage(): BootLanguage {
  const nav = globalThis.navigator as
    { languages?: readonly string[]; language?: string } | undefined;
  const tags =
    nav && Array.isArray(nav.languages) && nav.languages.length
      ? [...nav.languages]
      : nav?.language
        ? [nav.language]
        : [];
  for (const tag of tags) {
    const language = normalizeBootLanguage(tag);
    if (language) {
      return language;
    }
  }
  return "en";
}

/** The language the application is about to use, read from the preference mirror. */
function readBootLanguage(): BootLanguage {
  try {
    const raw = globalThis.localStorage?.getItem(PREFERENCE_MIRROR_KEY) ?? null;
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && "language" in parsed) {
        const value = (parsed as { language?: unknown }).language;
        if (typeof value === "string") {
          return normalizeBootLanguage(value) ?? "en";
        }
        if (value !== null && value !== undefined) {
          return "en";
        }
      }
    }
  } catch {
    // A disabled or full localStorage behaves like no stored preference.
  }
  return detectBootLanguage();
}

/** Fill the `{name}` slots of a splash template without the app's i18n bundle. */
function fillCopy(text: string, params: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/gu, (whole, name: string) =>
    Object.hasOwn(params, name) ? params[name] : whole,
  );
}

/** Read one JSON payload the build writes into a meta tag. */
function readMetaJson<T>(name: string): T | null {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta?.content) {
    return null;
  }
  try {
    return JSON.parse(meta.content) as T;
  } catch {
    return null;
  }
}

/** Read the build's file-size manifest, keeping only positive finite sizes. */
function readBootAssets(): Record<string, number> {
  const stored = readMetaJson<Record<string, unknown>>(ASSET_META);
  if (!stored) {
    return {};
  }
  const assets: Record<string, number> = {};
  for (const [url, size] of Object.entries(stored)) {
    if (typeof size === "number" && Number.isFinite(size) && size > 0) {
      assets[url] = size;
    }
  }
  return assets;
}

/** Pick the text for one language, falling back to English. */
function copyFor(language: BootLanguage, documentCopy: BootCopyDocument | null): BootCopy | null {
  return documentCopy?.[language] ?? documentCopy?.en ?? null;
}

/**
 * Attach the splash observer and write the first localized status.
 *
 * Called by the boot entry before the application entry. It is idempotent and
 * does nothing when the static splash is absent (for example after React has
 * already claimed the page).
 */
export function installBootSplash(): void {
  if (typeof document === "undefined" || stopRuntime || bootGlobal.__reduxBootDismissed) {
    return;
  }
  const splash = document.querySelector<HTMLElement>(SPLASH_SELECTOR);
  if (!splash) {
    return;
  }
  const message = splash.querySelector<HTMLElement>(".redux-boot-message");
  const detail = splash.querySelector<HTMLElement>(".redux-boot-detail");
  const progress = splash.querySelector<HTMLElement>(".redux-boot-progress");
  const fill = splash.querySelector<HTMLElement>(".redux-boot-progress-fill");
  if (!message || !detail || !progress || !fill) {
    return;
  }
  const splashElement: HTMLElement = splash;
  const messageElement: HTMLElement = message;
  const detailElement: HTMLElement = detail;
  const progressElement: HTMLElement = progress;
  const fillElement: HTMLElement = fill;

  const language = readBootLanguage();
  document.documentElement.lang = BOOT_HTML_LANG[language];
  document.documentElement.dataset.language = language;
  const copy = copyFor(language, readMetaJson<BootCopyDocument>(COPY_META));
  if (copy) {
    messageElement.textContent = copy.preparing;
    detailElement.textContent = copy.progress;
  }

  const assets = bootAssetIndex(readBootAssets(), document.baseURI);
  const timings = new Map<string, BootResourceTiming>();
  const startedAt = now();
  let stopped = false;
  let updateTimer = 0;
  let speedTimer = 0;
  let observer: PerformanceObserver | null = null;

  /** Write a status line only when it changed. */
  function setText(element: HTMLElement, value: string | null): void {
    if (value !== null && element.textContent !== value) {
      element.textContent = value;
    }
  }

  /** Build the download line for the current manifest mode. */
  function downloadText(
    current: BootCopy | null,
    snapshot: BootProgressSnapshot,
    downloaded: string,
    rate: string | null,
  ): string | null {
    if (!current) {
      return null;
    }
    if (snapshot.totalAssets > 0) {
      const total = formatByteSize(snapshot.totalBytes);
      return rate
        ? fillCopy(current.downloadingSpeed, { downloaded, total, speed: rate })
        : fillCopy(current.downloading, { downloaded, total });
    }
    return rate
      ? fillCopy(current.downloadedSpeed, { downloaded, speed: rate })
      : fillCopy(current.downloaded, { downloaded });
  }

  /** Record one completed resource entry and refresh the card. */
  function addTiming(entry: PerformanceEntry): void {
    if (entry.entryType !== "resource") {
      return;
    }
    const timing = entry as PerformanceResourceTiming;
    if (!Number.isFinite(timing.responseEnd) || timing.responseEnd <= 0) {
      return;
    }
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
  }

  /** Poll Resource Timing when the observer is unavailable. */
  function collect(): void {
    if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
      return;
    }
    for (const entry of performance.getEntriesByType("resource")) {
      addTiming(entry);
    }
    scheduleUpdate();
  }

  /** Stop the observer and timers once the splash is no longer on the page. */
  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    if (updateTimer) {
      window.clearTimeout(updateTimer);
      updateTimer = 0;
    }
    if (speedTimer) {
      window.clearInterval(speedTimer);
      speedTimer = 0;
    }
    observer?.disconnect();
    observer = null;
    if (stopRuntime === stop) {
      stopRuntime = null;
    }
  }

  /** Recompute the bar and status from the entries collected so far. */
  function update(): void {
    if (stopped) {
      return;
    }
    if (!splashElement.isConnected) {
      stop();
      return;
    }
    const snapshot = summarizeBootProgress([...timings.values()], assets);
    const rate = formatTransferRate(bootTransferRate(snapshot, Math.max(1, now() - startedAt)));
    const downloaded = formatByteSize(snapshot.loadedBytes);
    if (snapshot.totalAssets > 0) {
      if (snapshot.complete) {
        delete progressElement.dataset.bootIndeterminate;
        progressElement.setAttribute("aria-valuenow", "100");
        fillElement.style.transform = "scaleX(1)";
        setText(detailElement, copy?.progress ?? null);
      } else {
        delete progressElement.dataset.bootIndeterminate;
        progressElement.setAttribute("aria-valuenow", String(Math.floor(snapshot.ratio * 100)));
        fillElement.style.transform = `scaleX(${snapshot.ratio})`;
        setText(detailElement, downloadText(copy, snapshot, downloaded, rate));
      }
      return;
    }
    progressElement.dataset.bootIndeterminate = "true";
    progressElement.removeAttribute("aria-valuenow");
    fillElement.style.transform = "";
    setText(
      detailElement,
      snapshot.observedAssets > 0
        ? downloadText(copy, snapshot, downloaded, rate)
        : (copy?.progress ?? null),
    );
  }

  /** Coalesce resource bursts into one update per throttle window. */
  function scheduleUpdate(): void {
    if (stopped || updateTimer) {
      return;
    }
    if (!splashElement.isConnected) {
      stop();
      return;
    }
    updateTimer = window.setTimeout(() => {
      updateTimer = 0;
      update();
    }, UPDATE_THROTTLE_MS);
  }

  stopRuntime = stop;
  if (typeof PerformanceObserver !== "undefined") {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          addTiming(entry);
        }
        scheduleUpdate();
      });
      observer.observe({ type: "resource", buffered: true });
    } catch {
      observer = null;
    }
  }
  speedTimer = window.setInterval(() => {
    if (!observer) {
      collect();
    }
    scheduleUpdate();
  }, SPEED_REFRESH_MS);
  collect();
  update();
}

/**
 * Resolve once the deferred application stylesheet has loaded.
 *
 * The web build marks the sheet with `data-redux-boot-styles` and
 * `media="print"` so it cannot delay the splash. React waits for this promise;
 * `applyBootStyles` turns the sheet on in the same commit that removes the
 * splash, which avoids an unstyled startup screen. Hosts without a marked sheet
 * resolve immediately.
 */
export function waitForBootStyles(): Promise<void> {
  if (stylesReady) {
    return stylesReady;
  }
  stylesReady = new Promise<void>((resolve) => {
    if (typeof document === "undefined") {
      resolve();
      return;
    }
    const links = [...document.querySelectorAll<HTMLLinkElement>(STYLE_LINK_SELECTOR)];
    const pending = links.filter((link) => !link.sheet && link.dataset.bootStylesLoaded !== "true");
    if (pending.length === 0) {
      resolve();
      return;
    }
    let settled = false;
    let remaining = pending.length;
    let timer = 0;
    function finish(): void {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
      resolve();
    }
    timer = window.setTimeout(finish, BOOT_STYLE_TIMEOUT_MS);
    for (const link of pending) {
      let linkSettled = false;
      const settleOne = () => {
        if (linkSettled) {
          return;
        }
        linkSettled = true;
        link.dataset.bootStylesLoaded = "true";
        if (settled) {
          return;
        }
        remaining -= 1;
        if (remaining <= 0) {
          finish();
        }
      };
      link.addEventListener("load", settleOne, { once: true });
      link.addEventListener("error", settleOne, { once: true });
      // The sheet can finish between the filter above and this listener; check
      // once more so a fast cache hit cannot wait for the timeout.
      if (link.sheet || link.dataset.bootStylesLoaded === "true") {
        settleOne();
      }
    }
  });
  return stylesReady;
}

/**
 * Switch the deferred application stylesheet on.
 *
 * Called from `App`'s first layout effect, immediately before the splash is
 * removed, so the first paint that follows already has the application styles.
 */
export function applyBootStyles(): void {
  if (typeof document === "undefined") {
    return;
  }
  for (const link of document.querySelectorAll<HTMLLinkElement>(STYLE_LINK_SELECTOR)) {
    link.media = "all";
  }
}

/**
 * Remove the inline splash and stop its observer.
 *
 * `App` calls this from its first layout effect: React has committed the startup
 * screen by then, so the next paint shows the product interface with no blank
 * frame between the two surfaces.
 */
export function dismissBootSplash(): void {
  bootGlobal.__reduxBootDismissed = true;
  stopRuntime?.();
  stopRuntime = null;
  if (typeof document === "undefined") {
    return;
  }
  for (const style of document.querySelectorAll(STYLE_SELECTOR)) {
    style.remove();
  }
  for (const splash of document.querySelectorAll(SPLASH_SELECTOR)) {
    splash.remove();
  }
}
