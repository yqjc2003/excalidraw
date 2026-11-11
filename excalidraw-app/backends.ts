/**
 * Remote backends the app can talk to.
 *
 * The app ships without any remote backend configured: boards live in the
 * browser, boards are shared through the URL fragment, and everything else
 * is local. A backend is only used when its endpoint is configured through
 * the environment, so the app never reaches out to a service it wasn't set
 * up for.
 */

/** server-side share links (`#json=<id>,<key>`) */
export const isShareBackendConfigured = !!(
  import.meta.env.VITE_APP_BACKEND_V2_GET_URL &&
  import.meta.env.VITE_APP_BACKEND_V2_POST_URL
);

/** AI features (text to diagram, diagram to code) */
export const isAIBackendConfigured = !!import.meta.env.VITE_APP_AI_BACKEND;
