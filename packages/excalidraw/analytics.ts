// place here categories that you want to track. We want to track just a

import { isDevEnv } from "@excalidraw/common";

// small subset of categories at a given time.
const ALLOWED_CATEGORIES_TO_TRACK = new Set([
  "command_palette",
  "export",
  "ai",
]);

// NOTE: telemetry was intentionally removed from this build — no event (PV or
// behavioral) is ever sent anywhere. `trackEvent` is kept as a no-op so that
// the public API of `@excalidraw/excalidraw/analytics` and all of its call
// sites keep working. Set VITE_APP_ENABLE_TRACKING and plug your own
// analytics in below if you ever need them.
export const trackEvent = (
  category: string,
  action: string,
  label?: string,
  value?: number,
) => {
  try {
    if (
      typeof window === "undefined" ||
      import.meta.env.VITE_WORKER_ID ||
      import.meta.env.VITE_APP_ENABLE_TRACKING !== "true"
    ) {
      return;
    }

    if (!ALLOWED_CATEGORIES_TO_TRACK.has(category)) {
      return;
    }

    if (isDevEnv()) {
      // comment out to debug in dev
      return;
    }

    if (!import.meta.env.PROD) {
      console.info("trackEvent", { category, action, label, value });
    }
  } catch (error) {
    console.error("error during analytics", error);
  }
};
