# Groundskeeper

An operations workspace for a growing landscaping business: plan the day, assign crews, review project costs and organize a manageable workweek. Built for the business process improvement challenge using mock customer data.

**Live demo:** https://groundskeeper-nine.vercel.app

**Repository:** https://github.com/mayweajh-collab/Groundskeeper

The `main` branch is connected to the `groundskeeper` project in the RDBUILDS Vercel account. Pushes to `main` build and deploy the live site automatically. Keep credentials and `.env` files out of Git; the current demo integrations do not require API keys.

## What it does

- Lead with today's assignments, crew staffing, scheduling exceptions and overdue sample invoices.
- Assign and reschedule visits on a crew-by-week board, with a form that checks shifts, breaks, road travel, crew availability and conflicting work.
- Search maintenance and installation projects, inspect shared visits, and review their milestones, notes and sample scope documents.
- Reconcile project cost budgets, actual spending, outstanding commitments and additional work to finish. Forecast profit and margin update when the remaining forecast changes.
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

The demo begins with 50 mock customer visits. Its first operations-workspace migration adds six sample projects and up to five sample installation visits, subject to the existing 150-visit limit. Existing prices, service dates and crew reports are retained. Missing prices and specialty-service durations remain unknown until reviewed. Some visits therefore need an estimate before the planner can schedule them. The app retains every client record and shows unscheduled work explicitly. The dated sample workday is labeled in the interface; the Today control returns to that workday.

Jobs, prices, settings, plans, project notes, forecasts and check-ins are saved in browser storage on the current website. They are not shared across browsers or devices, and localhost storage is separate from the live site. A visible footer distinguishes browser saving from session-only changes when storage is unavailable. This prototype does not provide accounts, a shared database, live GPS tracking, accounting synchronization or email delivery. Completion messages are drafts for review.

Project finances use a separate, explicitly labeled sample ledger. They do not claim that modeled crew costs are recorded accounting expenses. Final forecast = actual spending + outstanding commitments + additional uncommitted cost to finish. Forecast cost to complete includes the latter two amounts. Profit = contract value minus final forecast; margin = profit divided by contract value. All figures are USD before tax. The patio example reconciles to $6,200 spent + $4,000 committed + $2,600 additional = $12,800 forecast; a $16,000 contract therefore yields $3,200 forecast profit and 20% margin. Outstanding commitments contain only unspent balances, avoiding double counting.

Service times are elapsed crew minutes. Increasing crew size changes labor cost without assuming a proportional productivity gain. Under the full-shift option, the labor budget includes full shifts only for crews activated by the plan. Review that assumption if idle crews must also be paid. The planner balances weekdays within the configured limits; it does not guarantee a global optimum or impose a fixed five-job limit.

Maps use Leaflet and OpenStreetMap, driving estimates use OSRM/FOSSGIS, forecasts use Open-Meteo, and U.S. address lookup uses the Census Geocoder. External services require an internet connection. Address results estimate a location along a street; verify them before dispatch. The assumed crew base can be changed in Business settings. Census request pacing and caching apply per server instance.

Third-party notices are in `THIRD-PARTY-NOTICES.txt`. Provider attribution remains visible in the dashboard.

Design references, responsive behavior and verification notes are documented in [docs/operations-workspace.md](docs/operations-workspace.md).
