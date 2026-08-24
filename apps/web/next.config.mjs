/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Real root cause of an earlier "Unsupported Server Component type:
  // undefined" crash (Phase 11 manual QA): packages/ui originally built to
  // CommonJS, and tsc's CJS emit prepends `"use strict";` BEFORE the
  // original `"use client";` directive — since a directive must be the
  // file's literal first statement to be recognized, that pushed "use
  // client" out of position and Next's RSC boundary detection silently
  // missed it. Fixed at the source: packages/ui now builds to ESM
  // (module:"ESNext" in its own tsconfig), where no "use strict" prologue
  // is ever emitted, so "use client" stays first. `transpilePackages` is
  // still required so Next's own compiler processes that ESM source.
  transpilePackages: ["@academic-precision/contracts", "@academic-precision/config", "@academic-precision/ui"],
};

export default nextConfig;
