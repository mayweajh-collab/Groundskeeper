# Groundskeeper

An operations workspace for a growing landscaping business: plan the day, assign crews, review project costs and organize a manageable workweek. Built for the business process improvement challenge using mock customer data.

**Live demo:** https://groundskeeper-nine.vercel.app

**Repository:** https://github.com/mayweajh-collab/Groundskeeper

The `main` branch is connected to the `groundskeeper` project in the RDBUILDS Vercel account. Pushes to `main` build and deploy the live site automatically. Keep credentials and `.env` files out of Git; the current demo integrations do not require API keys.

## What it does

- Sign in with managed Clerk accounts, create a business workspace, manage account security and sign out.
- Keep business data in private Neon Postgres records scoped to the verified owner account, with version checks to prevent stale devices from overwriting newer changes.
- Lead with today's assignments, crew staffing, scheduling exceptions and overdue sample invoices.
- Assign and reschedule visits on a crew-by-week board, with a form that checks shifts, breaks, road travel, crew availability and conflicting work.
- Search maintenance and installation projects, inspect shared visits, and review their milestones, notes and sample scope documents.
- Reconcile project cost budgets, actual spending, outstanding commitments and additional work to finish. Forecast profit and margin update when the remaining forecast changes.
- Import customer jobs from Excel or CSV, or add them manually.
- Estimate blank service times from editable mowing, edging, mulching and hedge-maintenance defaults, adding setup once per visit; optionally fill existing missing estimates.
- Resolve U.S. service addresses to estimated coordinates with the Census Geocoder.
- Suggest job prices from service time, crew size, road travel, materials, equipment, overhead and target margin. The operator reviews the price.
- Review and apply suggested prices for all eligible jobs or selected visits, with search, exact batch totals, explicit opt-in for replacing reviewed prices and an undo action.
- Show customer stops and road-following crew routes on a map, alongside the local forecast.
- Compare daily staffing and labor budgets, and propose a Monday–Friday schedule within crew shifts and available team size.
- Archive and restore clients, distinguish new and existing clients, and record crew check-ins and completed work.

## Service-time defaults

Open **Week optimizer → Team & daily limits → Import time defaults**. Configure mowing, edging, mulching, hedge maintenance and setup in elapsed crew minutes. When an imported or manually entered job has no total time, Groundskeeper adds the default for every requested service plus setup once. Entering a job-specific total overrides the defaults. Each calculated visit retains its original time breakdown in its estimate source, so later changes to the business defaults do not misrepresent an older estimate.

Mulching and hedge-maintenance defaults initially remain blank until the owner provides assumptions. A requested service with an unset default leaves the entire estimate unresolved. Combined defaults over 600 minutes require a job-specific estimate. These are starting assumptions to review for yard size, material volume and conditions; crew headcount does not automatically shorten elapsed service time.

To update already imported work, enable **Also fill missing estimates on existing jobs** before saving settings. The form previews how many visits can be filled. This applies only to active, unstarted visits without an estimate. Entered times, reviewed prices, service dates, assignments and reported or archived work are retained. Updated time estimates feed the refreshed daily costs and the next weekly proposal; the weekly plan still requires review before applying it.

## Bulk price review

In **Price studio**, choose **Review all suggestions** to start with every eligible job selected, or **Choose jobs** to select visits yourself. Search by client, address, service, crew or job ID. **Select matching jobs** selects only the current search results. The Jobs directory also offers **Price selected clients**, opening a visit-level review for those clients.

The review shows current and suggested prices, the service date, crew, modeled cost and travel basis before one **Apply suggested prices** action. Suggestions use each visit's service-day route, including its allocated return leg, or an explicitly saved travel allowance. Unscheduled visits use a standalone return trip. Existing reviewed prices are kept unless the operator enables their inclusion. Archived clients, skipped visits and work already started or completed cannot be bulk-priced. Missing time, crew or road estimates require individual review.

Applying a batch saves prices to the signed-in business account without changing schedules, reported time or project expense records. **Undo bulk prices** restores the last batch during the current page session, provided those jobs have not changed since. Reloading keeps the saved prices and clears the session-only undo history. Stale previews must be refreshed before applying.

## Run locally

Use Node.js 24 and npm:

```sh
npm ci
npm run build
npm test
npm start
```

Before starting, connect the existing Clerk and Neon integrations, pull development variables with `vercel env pull .env.local --yes`, and run `npm run accounts:setup`. Start Node with `node --env-file=.env.local server.js` so the local API can verify sessions and access the database. Open http://127.0.0.1:4180. Set `PORT` to choose a different local port. See [account setup](docs/business-accounts.md) for required variable names and production readiness.

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

The demo begins with 50 mock customer visits. Its first operations-workspace migration adds six sample projects and up to five sample installation visits, subject to the existing 150-visit limit. Existing prices, service dates and crew reports are retained. Missing prices remain unknown until reviewed. Specialty-service times require an entered estimate or owner-configured defaults. Some visits therefore need an estimate before the planner can schedule them. The app retains every client record and shows unscheduled work explicitly. The dated sample workday is labeled in the interface; the Today control returns to that workday.

Jobs, prices, settings, plans, project notes, forecasts and check-ins are saved to the signed-in owner's private business account. New accounts start empty unless the owner explicitly selects sample data or imports the previous browser workspace. The previous browser copy is retained during migration. The footer reports saving, saved, failed and conflict states. Account settings include backup download and retry controls. Live GPS tracking, accounting synchronization and customer email delivery remain outside this prototype; completion messages are drafts for review.

The provisioned Clerk instance currently uses development credentials for the hackathon preview. Configure a custom domain and a Clerk production instance before real customer use. Production credentials also require updating the exact Clerk host in the Content Security Policy. Business account isolation and API authorization are implemented, but this is not a claim of production security certification.

Project finances use a separate, explicitly labeled sample ledger. They do not claim that modeled crew costs are recorded accounting expenses. Final forecast = actual spending + outstanding commitments + additional uncommitted cost to finish. Forecast cost to complete includes the latter two amounts. Profit = contract value minus final forecast; margin = profit divided by contract value. All figures are USD before tax. The patio example reconciles to $6,200 spent + $4,000 committed + $2,600 additional = $12,800 forecast; a $16,000 contract therefore yields $3,200 forecast profit and 20% margin. Outstanding commitments contain only unspent balances, avoiding double counting.

Service times are elapsed crew minutes. Increasing crew size changes labor cost without assuming a proportional productivity gain. Under the full-shift option, the labor budget includes full shifts only for crews activated by the plan. Review that assumption if idle crews must also be paid. The planner balances weekdays within the configured limits; it does not guarantee a global optimum or impose a fixed five-job limit.

Maps use Leaflet and OpenStreetMap, driving estimates use OSRM/FOSSGIS, forecasts use Open-Meteo, and U.S. address lookup uses the Census Geocoder. External services require an internet connection. Address results estimate a location along a street; verify them before dispatch. The assumed crew base can be changed in Business settings. Census request pacing and caching apply per server instance.

Third-party notices are in `THIRD-PARTY-NOTICES.txt`. Provider attribution remains visible in the dashboard.

Design references, responsive behavior and verification notes are documented in [docs/operations-workspace.md](docs/operations-workspace.md).
