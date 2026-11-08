# Groundskeeper

A dashboard for a small lawn-care business owner who wants to plan crews, review job prices and organize a manageable workweek. Built for the business process improvement challenge using mock customer data.

**Live demo:** https://groundskeeper-nine.vercel.app

## What it does

- Import customer jobs from Excel or CSV, or add them manually.
- Resolve U.S. service addresses to estimated coordinates with the Census Geocoder.
- Suggest job prices from service time, crew size, road travel, materials, equipment, overhead and target margin. The operator reviews the price.
- Show customer stops and road-following crew routes on a map, alongside the local forecast.
- Compare daily staffing and labor budgets, and propose a Monday–Friday schedule within crew shifts and available team size.
- Archive and restore clients, distinguish new and existing clients, and record crew check-ins and completed work.

## Run locally

Use Node.js 24 and npm:

```sh
npm ci
npm run build
npm test
npm start
```

Open http://127.0.0.1:4180. Set `PORT` to choose a different local port. No API key or `.env` file is needed for this demo. `npm run dev` also rebuilds and starts the local server.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/lawn/` | Editable dashboard HTML, CSS and interface code |
| `lib/` | Pricing, import, routing, scheduling and address-lookup logic |
| `data/` | Mock customers and routing test fixtures |
| `scripts/build.js` | Build the browser assets and downloadable import template |
| `server.js` | Local preview server |
| `api/index.js` | Vercel function for address lookup and health checks |
| `tests/` | Application behavior and API checks |
| `public/` | Generated assets; rebuilt during deployment and excluded from Git |

Vercel uses the included configuration to install dependencies, run `npm run build`, serve `public/`, and expose `/api/lawn/geocode` and `/api/health`. Browser scripts and styles are served as separate assets so source changes can be built automatically without updating inline-script hashes.

An optional GitHub Actions test workflow is included at `docs/ci-checks.yml`. It is a setup template; automatic test runs are not enabled. The application checks can be run locally with `npm test`.

## Data and planning assumptions

The demo begins with 50 mock customer visits. Missing prices and specialty-service durations remain unknown until reviewed. Some visits therefore need an estimate before the planner can schedule them. The app retains every client record and shows unscheduled work explicitly.

Jobs, prices, settings, plans and check-ins are saved in browser storage on the current website. They are not shared across browsers or devices, and localhost storage is separate from the live site. This prototype does not provide accounts, a shared database, live GPS tracking or email delivery. Completion messages are drafts for review.

Service times are elapsed crew minutes. Increasing crew size changes labor cost without assuming a proportional productivity gain. Under the full-shift option, the labor budget includes full shifts only for crews activated by the plan. Review that assumption if idle crews must also be paid. The planner balances weekdays within the configured limits; it does not guarantee a global optimum or impose a fixed five-job limit.

Maps use Leaflet and OpenStreetMap, driving estimates use OSRM/FOSSGIS, forecasts use Open-Meteo, and U.S. address lookup uses the Census Geocoder. External services require an internet connection. Address results estimate a location along a street; verify them before dispatch. The assumed crew base can be changed in Business settings. Census request pacing and caching apply per server instance.

Third-party notices are in `THIRD-PARTY-NOTICES.txt`. Provider attribution remains visible in the dashboard.
