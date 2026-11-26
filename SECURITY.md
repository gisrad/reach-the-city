# Security & API Compliance Policy

## Credential & Infrastructure Boundaries

- **Zero Secrets in Source Control**: Production API keys, Cloudflare Worker configurations (`wrangler.toml`), and local environment files (`.env`, `.dev.vars`) are never committed to this repository.
- **Edge Secret Isolation**: In production (`reach.transbulent.id`), optional third-party API keys are stored solely as encrypted Cloudflare Worker Secrets and are never bundled into browser assets or returned in HTTP responses.
- **Automated CI Gate**: Every commit and pull request runs `npm run check:security` (`scripts/security-check.mjs`), failing if hardcoded credentials, provider tokens, Cloudflare account IDs, non-zero UUIDs, email addresses, or local filesystem paths appear in tracked files.

## Google Maps Platform Terms of Service Compliance

- **No Route Matrix Mass Caching**: All 3D travel-time isochrone surfaces are computed 100% client-side in a Web Worker over open graph bundles, avoiding Route Matrix caching or display violations.
- **No Persistent Route Storage**: Live verification endpoints enforce `Cache-Control: private, no-store` and perform zero persistent storage (no D1, KV, or R2 caching of Google responses).
- **No Polyline Display on Non-Google Maps**: Live route verification requests return travel duration, distance, and transit step summaries alongside a direct "Open in Google Maps" link, without drawing Google route polylines onto MapLibre/OpenStreetMap basemaps.

## Supported Versions

Only the latest state of the `main` branch and the live deployment at `https://reach.transbulent.id` are supported.

## Reporting a Vulnerability

If you discover a security issue, please report it privately via GitHub Security Advisories:

- <https://github.com/gisrad/reach-the-city/security/advisories/new>

Please do not open public issues for unpatched security vulnerabilities.
