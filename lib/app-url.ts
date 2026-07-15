/**
 * ONE link base for every surface that mints an absolute URL (verification
 * links, payment return URLs, re-engagement links). Task 4.1 (D6): the call
 * sites used to disagree on the fallback port (3000 vs 3001) — dev runs on
 * 3001, so a missing APP_URL minted dead links.
 */
export function appBaseUrl(): string {
  const configured = process.env.APP_URL
  return configured && configured.length > 0 ? configured : 'http://localhost:3001'
}
