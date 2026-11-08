import {neon} from '@neondatabase/serverless';
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL must be configured before setting up account storage.');
const sql=neon(process.env.DATABASE_URL);
await sql.query(`CREATE TABLE IF NOT EXISTS groundskeeper_workspaces (
 account_id text PRIMARY KEY,
 payload jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
)`);
console.log('Groundskeeper private account storage is ready.');
