/**
 * Build-time markup, copy, and first-frame styles for the inline startup splash.
 *
 * `vite.config.ts` calls this while transforming `index.html`, so a browser can
 * paint the same icon, wordmark, preparing copy, and progress card that
 * `StartupView` shows before any stylesheet or application chunk has loaded.
 * The strings come from the message catalogs, which keeps the static splash and
 * the React startup screen from drifting apart.
 *
 * This module is imported by the build only. The application imports its copy
 * type, never the catalog-backed markup.
 */
import enCommon from "../../../i18n/messages/en/common.ts";
import enSettings from "../../../i18n/messages/en/settings.ts";
import zhCommon from "../../../i18n/messages/zh/common.ts";
import zhSettings from "../../../i18n/messages/zh/settings.ts";

/** One language's splash text. */
export interface BootCopy {
  readonly appName: string;
  readonly preparing: string;
  readonly progress: string;
  readonly downloading: string;
  readonly downloadingSpeed: string;
  readonly downloaded: string;
  readonly downloadedSpeed: string;
}

/** Splash text for both supported languages. */
export type BootCopyDocument = Record<"en" | "zh", BootCopy>;

/** The translation table the build writes into the splash metadata. */
export function bootSplashCopy(): BootCopyDocument {
  return {
    en: {
      appName: enCommon["common.appName"],
      preparing: enSettings["settings.startup.preparing"],
      progress: enSettings["settings.startup.progress"],
      downloading: enSettings["settings.startup.downloading"],
      downloadingSpeed: enSettings["settings.startup.downloadingSpeed"],
      downloaded: enSettings["settings.startup.downloaded"],
      downloadedSpeed: enSettings["settings.startup.downloadedSpeed"],
    },
    zh: {
      appName: zhCommon["common.appName"],
      preparing: zhSettings["settings.startup.preparing"],
      progress: zhSettings["settings.startup.progress"],
      downloading: zhSettings["settings.startup.downloading"],
      downloadingSpeed: zhSettings["settings.startup.downloadingSpeed"],
      downloaded: zhSettings["settings.startup.downloaded"],
      downloadedSpeed: zhSettings["settings.startup.downloadedSpeed"],
    },
  };
}

/** Escape text inserted into the static splash markup. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The splash markup, inserted beside the React root.
 *
 * The card mirrors `StartupView`'s loading state. English is the static default
 * because the document language is not known until the boot runtime reads the
 * preference mirror; that runtime replaces both lines for Chinese users before
 * the first resources finish.
 */
export function bootSplashMarkup(copy: BootCopyDocument = bootSplashCopy()): string {
  const english = copy.en;
  return `<div class="redux-boot" data-redux-boot>
      <div class="redux-boot-card">
        <img class="redux-boot-icon" src="./assets/redux/brand/redux-app-icon.png" width="72" height="72" alt="" decoding="async" />
        <h1 class="redux-boot-title">
          <img class="redux-boot-wordmark" src="./assets/redux/brand/redux-wordmark-on-dark.png" width="160" height="28" alt="${escapeHtml(english.appName)}" decoding="async" />
        </h1>
        <p class="redux-boot-message" id="redux-boot-message" role="status" aria-live="polite">${escapeHtml(english.preparing)}</p>
        <div class="redux-boot-progress" role="progressbar" aria-labelledby="redux-boot-message" aria-valuemin="0" aria-valuemax="100" data-boot-indeterminate="true">
          <span class="redux-boot-progress-fill"></span>
        </div>
        <small class="redux-boot-detail">${escapeHtml(english.progress)}</small>
      </div>
    </div>`;
}

/**
 * First-frame styles for the splash.
 *
 * The surface stays on the dark palette even when the stored theme is light:
 * it is the palette the document already paints before the theme registry runs,
 * and it keeps the on-dark wordmark readable. Colours come from the built-in
 * dark package, never from a second hand-written palette. The system font stack
 * keeps the large CJK face off the boot path; the application stylesheet is
 * applied only when React takes over.
 */
export function bootSplashStyle(colors: Readonly<Record<string, string>>): string {
  const color = (name: string): string => {
    const value = colors[name];
    if (!value) {
      throw new Error(`The dark theme package is missing the ${name} colour`);
    }
    return value;
  };
  const surface = color("--surface");
  const foreground = color("--foreground");
  const muted = color("--foreground-muted");
  const accent = color("--accent");
  const track = color("--surface-muted");
  return `
html {
  background: ${surface};
  color-scheme: dark;
}
body {
  margin: 0;
  background: ${surface};
}
.redux-boot {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-toast, 1300) + 1);
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: ${surface};
  color: ${foreground};
  color-scheme: dark;
  font-family: system-ui, "Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  font-size: 1rem;
  line-height: 1.5;
  text-align: center;
  user-select: none;
}
.redux-boot-card {
  width: min(28rem, calc(100% - 3rem));
  margin: auto;
  padding: 2rem 0;
  text-align: center;
}
.redux-boot-icon {
  display: block;
  width: 4.5rem;
  height: 4.5rem;
  margin: 0 auto 1.25rem;
  object-fit: contain;
}
.redux-boot-title {
  margin: 0;
}
.redux-boot-wordmark {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
.redux-boot-message {
  margin: 0.5rem 0 1.25rem;
}
.redux-boot-detail {
  color: ${muted};
  font-size: 0.8125rem;
}
.redux-boot-progress {
  position: relative;
  height: 0.1875rem;
  margin: 1.5rem 0 0.75rem;
  overflow: hidden;
  border-radius: 0.125rem;
  background: ${track};
}
.redux-boot-progress-fill {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: ${accent};
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 180ms ease-out;
}
.redux-boot-progress[data-boot-indeterminate="true"] .redux-boot-progress-fill {
  width: 40%;
  transform: none;
  animation: redux-boot-slide 1.2s linear infinite;
}
@keyframes redux-boot-slide {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .redux-boot-progress-fill {
    transition: none;
  }
  .redux-boot-progress[data-boot-indeterminate="true"] .redux-boot-progress-fill {
    width: 100%;
    animation: none;
  }
}
`;
}
