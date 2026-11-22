import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fingerprintToken } from '../services/botSecrets.js';
import '../config.js';

const connection = process.env.MIGRATION_DATABASE_URL;
function runSql(sql) {
  const target = new URL(connection);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !target.hostname || !target.pathname.slice(1)) {
    throw new Error('MIGRATION_DATABASE_URL must be a PostgreSQL connection URI.');
  }
  const sslMode = target.searchParams.get('sslmode') || 'require';
  if (!['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error('The migration connection must require TLS.');
  }
  const result = spawnSync('psql', ['-X', '--no-password', '--set=ON_ERROR_STOP=1', '--single-transaction'], {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit'],
    env: {
      ...process.env,
      PGHOST: target.hostname,
      PGPORT: target.port || '5432',
      PGDATABASE: decodeURIComponent(target.pathname.slice(1)),
      PGUSER: decodeURIComponent(target.username),
      PGPASSWORD: decodeURIComponent(target.password),
      PGSSLMODE: sslMode,
      PGCONNECT_TIMEOUT: '10',
    },
  });
  if (result.error) throw new Error('Could not launch psql. Install the PostgreSQL client in the migration environment.');
  if (result.status !== 0) throw new Error('Database migration failed. Review the PostgreSQL error above.');
}

try {
  if (!connection) throw new Error('Set MIGRATION_DATABASE_URL to the target Supabase PostgreSQL connection string.');
  fingerprintToken('');
  const hardening = readFileSync(new URL('./migrations/harden_tenant_and_telegram.sql', import.meta.url), 'utf8')
    .replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
  runSql(`
    select pg_advisory_xact_lock(781534620);
    create schema if not exists resolvedesk_migrations;
    revoke all on schema resolvedesk_migrations from public, anon, authenticated;
    create table if not exists resolvedesk_migrations.applied (version text primary key);
    select not exists (
      select 1 from resolvedesk_migrations.applied where version = 'tenant_telegram_v1'
    ) as pending \\gset
    \\if :pending
      select (
        to_regprocedure('public.process_telegram_update()') is not null
        and to_regclass('public.telegram_update_inbox') is not null
        and to_regclass('public.workspace_revisions') is not null
        and exists (
          select 1 from pg_constraint where conrelid = 'public.bots'::regclass
            and conname = 'bots_encrypted_token'
        )
      ) as installed \\gset
      \\if :installed
        \\echo Adopting the previously applied hardening migration.
      \\else
        ${hardening}
      \\endif
      insert into resolvedesk_migrations.applied values ('tenant_telegram_v1');
    \\endif
    -- Earlier successful manual installs validated every tenant reference already.
    alter table public.complaints add column if not exists isolation_review_required boolean not null default false;
    notify pgrst, 'reload schema';
  `);

  const backfill = spawnSync(process.execPath, [fileURLToPath(new URL('./migrateBotTokens.js', import.meta.url))], {
    stdio: 'inherit',
  });
  if (backfill.status !== 0) throw new Error('Bot token backfill failed. Fix the reported error and rerun the migration.');
  runSql('alter table public.bots validate constraint bots_encrypted_token;');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
