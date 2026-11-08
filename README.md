# POS System frontend foundation

Responsive React + TypeScript foundation for a multi-device POS app. Includes routing, reusable layout components, demo-only dashboard data, and backend-ready API configuration. Sales workflows, persistence, and offline synchronization are intentionally outside this phase.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```sh
npm install
cp .env.example .env.local
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env.local`. `VITE_API_BASE_URL` is optional until the Cloudflare Workers API is available.

## Scripts

- `npm run dev` — start Vite
- `npm run build` — TypeScript project checks and production build
- `npm run preview` — preview the production build
- `npm run lint` — run Oxlint

## Notes

- `src/features/*` contains independent business module page entry points.
- The authentication guard is a development placeholder and currently treats the user as authenticated.
- Dashboard mock values live in `src/features/dashboard/data/dashboardDemo.ts` only.
- PKR formatting and Asia/Karachi timezone helpers are in `src/lib`.
- The PWA manifest and SVG icon placeholders are included; there is no service worker or offline sync yet.
- `src/lib/api-client.ts` does not generate fake responses and requires a configured API base URL before making requests.
