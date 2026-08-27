/**
 * Rasid Design System — packages/ui (Phase 11).
 *
 * The shared, reusable component library apps/web builds every screen on
 * top of. Radix UI primitives underneath for accessibility (focus
 * trapping, keyboard nav, ARIA) — this file is the ONE place that surface
 * is re-exported with Rasid's own visual language applied, so no screen
 * ever imports `@radix-ui/*` directly.
 */
export * from "./lib/cn";
export * from "./lib/format";

export * from "./primitives/button";
export * from "./primitives/input";
export * from "./primitives/textarea";
export * from "./primitives/label";
export * from "./primitives/field";
export * from "./primitives/card";
export * from "./primitives/badge";
export * from "./primitives/skeleton";
export * from "./primitives/state-views";
export * from "./primitives/dialog";
export * from "./primitives/sheet";
export * from "./primitives/dropdown-menu";
export * from "./primitives/tabs";
export * from "./primitives/select";
export * from "./primitives/toaster";
export * from "./primitives/tooltip";
export * from "./primitives/popover";
export * from "./primitives/avatar";
export * from "./primitives/separator";
export * from "./primitives/checkbox";
export * from "./primitives/switch";
export * from "./primitives/table";
export * from "./primitives/cursor-pagination";
export * from "./primitives/confirm-dialog";
export * from "./primitives/spinner";
export * from "./primitives/filter-bar";
export * from "./primitives/metric-strip";
export * from "./primitives/timeline";
