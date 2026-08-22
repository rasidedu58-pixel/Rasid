/**
 * Do not import this barrel from browser code — it re-exports the
 * server-only module. Client bundles must import "@academic-precision/config/browser"
 * explicitly, and server code should import "@academic-precision/config/server".
 */
export * from "./browser";
export * from "./server";
