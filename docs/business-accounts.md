# Business accounts

Groundskeeper uses Clerk for identity and account recovery and Neon Postgres for private workspaces. The existing framework, imports, pricing, projects, routing and scheduling remain in place.

## Current readiness

The selected Marketplace plans are Clerk Hobby and Neon Free. The user accepted both providers' terms in Vercel before provisioning. Clerk currently supplies development-instance credentials, and the interface identifies preview accounts. Move to a custom domain and configure a Clerk production instance before real customer use; the development instance is appropriate for the hackathon preview, not a completed customer launch. Production and development account databases and credentials should be separated before launch.

## Behavior

- Signed-out visitors see the Groundskeeper login screen. Sign-in, sign-up, recovery and profile security use Clerk's hosted Account Portal; Groundskeeper does not collect or store passwords.
- Each verified owner account has its own business workspace. Team invitations and shared-business membership roles are not implemented in this version.
- New accounts choose a clean workspace, fictional sample data or the previous browser workspace. Migration is explicit and retains the old browser copy.
- Workspace changes save to the account. The footer reports pending, successful, failed and conflicting saves. Account settings offer retry and backup download.
- An optimistic version number prevents another tab or device from silently overwriting newer changes. On conflict, download the open changes and reload the saved version before reconciling.
- Sign-out closes and removes private dashboard and dialog content. Account changes invalidate the previous workspace context. Private account records are not cached in browser local storage.

## API protections

`/api/account/config` exposes only the publishable key, readiness and preview status. `/api/health` contains generic readiness information. Workspace reads/writes, account inspection and address geocoding require a Bearer session token. Clerk validates the signature, expiry and authorized originating party; the API also checks that the corresponding session is active. An unavailable session-verification service prevents private access while allowing the client to retry saving.

Database ownership always comes from the verified account ID, never a caller-provided owner ID. Every read and update constrains that account ID. New writes use a unique account key; subsequent writes require an exact version match. Requests reject cross-site origins, cookie-only credentials, unsupported methods, invalid schedules, unsafe property names and bodies over 3.5 MB. Private API responses prohibit caching, and unexpected errors omit internal query and credential details. Database credentials remain server-side; the browser calls only the account API.

The current schema stores one JSON workspace per owner in `groundskeeper_workspaces`. Application queries enforce ownership. This implementation does not claim database row-level security policies or an independent security audit.

## Configuration

Required server variables:

- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (or `CLERK_PUBLISHABLE_KEY`)
- `DATABASE_URL`

`GROUNDSKEEPER_APP_URL` may set the canonical app origin. Vercel preview and production host names are added from the platform's trusted environment variables. Local development allows the established local preview ports only. The exact Clerk Frontend API host is allowed in `vercel.json`; update it when changing Clerk instances. The browser SDK is pinned and copied into generated public assets; inline scripts and unrestricted script sources remain disallowed.

Use the linked `rdbuilds/groundskeeper` Vercel project. Pull variables into ignored local files without printing values. Run `node --env-file=.env.local scripts/setup-accounts.js` for the target database before starting the server. The setup creates the dedicated workspace table if absent and never drops existing records. The build and Git repository contain no authentication secret or database connection string. Never commit `.env` or `.vercel` files.

## Verification

The automated suite contains 79 checks, including private API access, account scoping, forged-token rejection, cross-site writes, stale-device conflicts, bounded request bodies, schema validation, save sequencing and preservation of prior operational behavior.

Browser testing used two temporary, verified Clerk test accounts and the real Neon database. It checked hosted sign-in, first-business setup, saved business-name changes, customer import, reload persistence, sign-out, a separate empty workspace for the second account, and restoration of the first account's records on return. Temporary accounts and their rows are removed after verification. Owner credentials are created by the user in the managed sign-up flow, never in this chat.
