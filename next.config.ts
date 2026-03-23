import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
};

// Wrap with Sentry for source map uploads and error instrumentation.
// If Sentry is not configured (no SENTRY_AUTH_TOKEN), the wrapper is still
// safe — it simply skips the upload step.
export default withSentryConfig(nextConfig, {
  // Only upload source maps when auth token is available (CI/CD build)
  silent: !process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
