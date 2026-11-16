#!/usr/bin/env bash
# Apply Readest schema migrations to a hosted Supabase database.
#
# The source of truth is docker/volumes/db/migrations/, the same files the
# bundled docker stack applies. Applied files are recorded in
# readest_meta.migrations, so this is safe to run on every deploy: only new
# files run.
#
# Transactional files are applied in one transaction together with their ledger
# row. Files that need per-statement autocommit (CREATE INDEX CONCURRENTLY,
# VALIDATE CONSTRAINT, VACUUM, CALL into a procedure that COMMITs, ...) run
# through psql -f instead. This mirrors docker/volumes/db/apply-migrations.sh
# and, importantly, preserves the migrations' own locking assumptions: 023 /
# 025 / 027 add a NOT VALID constraint and then VALIDATE it, relying on the ADD
# committing before the scan so the ACCESS EXCLUSIVE lock is not held across it.
#
# First run against a database that predates the ledger: set MIGRATION_BASELINE
# to the last migration already reflected in that database. Supported baselines
# are 018_add_metadata_updated_at.sql, 022_add_group_updated_at.sql and
# 033_add_book_notes_crosspoint.sql. Each one verifies schema markers before a
# single baseline transaction marks files up to it as applied.
#
# Required env: SUPABASE_DB_URL (Supabase Session pooler connection URI).
set -euo pipefail
export LC_ALL=C

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required (Supabase Session pooler URI)}"

MIGRATIONS_DIR="${MIGRATIONS_DIR:-docker/volumes/db/migrations}"
MIGRATION_BASELINE="${MIGRATION_BASELINE:-}"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "MIGRATIONS_DIR not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob
if [ "${#migrations[@]}" -eq 0 ]; then
  echo "No .sql migrations in $MIGRATIONS_DIR" >&2
  exit 1
fi

# Catch a typo before opening a connection. The baseline value is a file name,
# not a prefix: "018" would otherwise silently change which files are marked.
if [ -n "$MIGRATION_BASELINE" ] && [ ! -f "$MIGRATIONS_DIR/$MIGRATION_BASELINE" ]; then
  echo "MIGRATION_BASELINE must name a file in $MIGRATIONS_DIR; got: $MIGRATION_BASELINE" >&2
  exit 1
fi

psql_db() {
  psql -v ON_ERROR_STOP=1 --no-psqlrc -X "$SUPABASE_DB_URL" "$@"
}

sql_literal() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

# Returns 0 when the file must run through psql -f (autocommit per statement).
# Keep this as one awk process: `awk | grep -q` under pipefail can return 141
# when grep exits early, which would misclassify a concurrent-index migration
# and then fail inside BEGIN/COMMIT.
is_non_transactional() {
  awk '
    {
      line = $0
      sub(/--.*/, "", line)
      l = tolower(line)
      if (l ~ /concurrently/ ||
          l ~ /validate[[:space:]]+constraint/ ||
          l ~ /^[[:space:]]*(begin|commit|rollback)[[:space:]]*;/ ||
          l ~ /^[[:space:]]*(vacuum|reindex|cluster)([[:space:]]|;)/ ||
          l ~ /^[[:space:]]*(create|drop)[[:space:]]+database[[:space:]]/ ||
          l ~ /^[[:space:]]*alter[[:space:]]+system[[:space:]]/ ||
          l ~ /^[[:space:]]*call[[:space:]]/ ||
          l ~ /^[[:space:]]*alter[[:space:]]+type[[:space:]]/) {
        found = 1
        exit
      }
    }
    END { exit(found ? 0 : 1) }
  ' "$1"
}

# Schema markers for the state every supported baseline shares. This is the
# 018 shape: base tables plus migrations 001, 002, 003, 012, 013, 014, 015,
# 016, 017 and 018.
verify_base_schema() {
  psql_db <<'SQL'
do $$
begin
  if to_regclass('public.books') is null
     or to_regclass('public.book_configs') is null
     or to_regclass('public.book_notes') is null
     or to_regclass('public.files') is null then
    raise exception 'baseline: the base Readest tables are missing; run docker/supabase-init.sql first.';
  end if;

  if to_regclass('public.book_shares') is null then
    raise exception 'baseline: public.book_shares is missing (migration 002 not applied).';
  end if;
  if to_regclass('public.replicas') is null then
    raise exception 'baseline: public.replicas is missing (migration 003 not applied).';
  end if;
  if to_regclass('public.send_inbox') is null then
    raise exception 'baseline: public.send_inbox is missing (migration 012 not applied).';
  end if;
  if to_regclass('public.stat_pages') is null then
    raise exception 'baseline: public.stat_pages is missing (migration 014 not applied).';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'book_configs' and column_name = 'rsvp_position'
  ) then
    raise exception 'baseline: book_configs.rsvp_position is missing (migration 001 not applied).';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'book_notes' and column_name = 'global'
  ) then
    raise exception 'baseline: book_notes.global is missing (migration 013 not applied).';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'reading_status_updated_at'
  ) then
    raise exception 'baseline: books.reading_status_updated_at is missing (migration 015 not applied).';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'synced_at'
  ) then
    raise exception 'baseline: books.synced_at is missing (migration 016 not applied).';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'cover_hash'
  ) then
    raise exception 'baseline: books.cover_hash is missing (migration 017 not applied).';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'cover_updated_at'
  ) then
    raise exception 'baseline: books.cover_updated_at is missing (migration 017 not applied).';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'metadata_updated_at'
  ) then
    raise exception 'baseline: books.metadata_updated_at is missing (migration 018 not applied).';
  end if;
end $$;
SQL
}

# 018 may still be used when 019-021 were applied (they are safe to re-run).
# 022 is the hard upper bound: group_updated_at cannot exist before 022.
verify_baseline_018() {
  verify_base_schema
  psql_db <<'SQL'
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'group_updated_at'
  ) then
    raise exception 'Database is at or past migration 022 (books.group_updated_at exists); use MIGRATION_BASELINE=022_add_group_updated_at.sql or 033_add_book_notes_crosspoint.sql.';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.replicas'::regclass
      and conname = 'replicas_kind_allowlist'
      and pg_get_constraintdef(oid) like '%bookshelf%'
  ) then
    raise exception 'Database is at or past migration 023 (replicas_kind_allowlist allows bookshelf); inspect and seed readest_meta.migrations manually.';
  end if;
  if to_regclass('public.crosspoint_devices') is not null then
    raise exception 'Database is at or past migration 024 (public.crosspoint_devices exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if to_regclass('public.crosspoint_documents') is not null then
    raise exception 'Database is at or past migration 025 (public.crosspoint_documents exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'book_notes' and column_name = 'ink'
  ) then
    raise exception 'Database is at or past migration 026 (book_notes.ink exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'page_count'
  ) then
    raise exception 'Database is at or past migration 028 (books.page_count exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'book_configs' and column_name = 'tts_packs'
  ) then
    raise exception 'Database is at or past migration 030 (book_configs.tts_packs exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'original_filename'
  ) then
    raise exception 'Database is at or past migration 031 (books.original_filename exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if to_regclass('public.vocabulary') is not null then
    raise exception 'Database is at or past migration 032 (public.vocabulary exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'book_notes' and column_name = 'crosspoint'
  ) then
    raise exception 'Database is at or past migration 033 (book_notes.crosspoint exists); use MIGRATION_BASELINE=033_add_book_notes_crosspoint.sql.';
  end if;
end $$;
SQL
}

# 022 means 019-022 are present and 023+ are not.
verify_baseline_022() {
  verify_base_schema
  psql_db <<'SQL'
do $$
begin
  if to_regprocedure('public.upsert_stat_pages(jsonb)') is null then
    raise exception 'baseline 022: public.upsert_stat_pages(jsonb) is missing (migration 019 not applied).';
  end if;
  if to_regclass('public.stat_archives') is null then
    raise exception 'baseline 022: public.stat_archives is missing (migration 020 not applied).';
  end if;
  if to_regprocedure('public.stat_archive_rows(uuid,timestamp with time zone,interval,integer,text,integer,bigint)') is null then
    raise exception 'baseline 022: the migration 021 stat_archive_rows signature is missing.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'group_updated_at'
  ) then
    raise exception 'baseline 022: books.group_updated_at is missing (migration 022 not applied); use MIGRATION_BASELINE=018_add_metadata_updated_at.sql.';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.replicas'::regclass
      and conname = 'replicas_kind_allowlist'
      and pg_get_constraintdef(oid) like '%bookshelf%'
  ) then
    raise exception 'Database is at or past migration 023 (replicas_kind_allowlist allows bookshelf); inspect and seed readest_meta.migrations manually.';
  end if;
  if to_regclass('public.crosspoint_devices') is not null then
    raise exception 'Database is at or past migration 024 (public.crosspoint_devices exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if to_regclass('public.crosspoint_documents') is not null then
    raise exception 'Database is at or past migration 025 (public.crosspoint_documents exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.replicas'::regclass
      and conname = 'replicas_kind_allowlist'
      and pg_get_constraintdef(oid) like '%custom_translator%'
  ) then
    raise exception 'Database is at or past migration 025 (replicas_kind_allowlist allows custom_translator); inspect and seed readest_meta.migrations manually.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'book_notes' and column_name = 'ink'
  ) then
    raise exception 'Database is at or past migration 026 (book_notes.ink exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.replicas'::regclass
      and conname = 'replicas_kind_allowlist'
      and pg_get_constraintdef(oid) like '%custom_tts%'
  ) then
    raise exception 'Database is at or past migration 027 (replicas_kind_allowlist allows custom_tts); inspect and seed readest_meta.migrations manually.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'page_count'
  ) then
    raise exception 'Database is at or past migration 028 (books.page_count exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'book_configs' and column_name = 'tts_packs'
  ) then
    raise exception 'Database is at or past migration 030 (book_configs.tts_packs exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'original_filename'
  ) then
    raise exception 'Database is at or past migration 031 (books.original_filename exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if to_regclass('public.vocabulary') is not null then
    raise exception 'Database is at or past migration 032 (public.vocabulary exists); inspect and seed readest_meta.migrations manually.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'book_notes' and column_name = 'crosspoint'
  ) then
    raise exception 'Database is at or past migration 033 (book_notes.crosspoint exists); inspect and seed readest_meta.migrations manually.';
  end if;
end $$;
SQL
}

# 033 means every migration through 033 is present.
verify_baseline_033() {
  verify_base_schema
  psql_db <<'SQL'
do $$
begin
  if to_regprocedure('public.upsert_stat_pages(jsonb)') is null then
    raise exception 'baseline 033: public.upsert_stat_pages(jsonb) is missing (migration 019 not applied).';
  end if;
  if to_regclass('public.stat_archives') is null then
    raise exception 'baseline 033: public.stat_archives is missing (migration 020 not applied).';
  end if;
  if to_regprocedure('public.stat_archive_rows(uuid,timestamp with time zone,interval,integer,text,integer,bigint)') is null then
    raise exception 'baseline 033: the migration 021 stat_archive_rows signature is missing.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'group_updated_at'
  ) then
    raise exception 'baseline 033: books.group_updated_at is missing (migration 022 not applied).';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.replicas'::regclass
      and conname = 'replicas_kind_allowlist'
      and pg_get_constraintdef(oid) like '%bookshelf%'
  ) then
    raise exception 'baseline 033: replicas_kind_allowlist does not allow bookshelf (migration 023 not applied).';
  end if;
  if to_regclass('public.crosspoint_devices') is null then
    raise exception 'baseline 033: public.crosspoint_devices is missing (migration 024 not applied).';
  end if;
  if to_regclass('public.crosspoint_device_codes') is null then
    raise exception 'baseline 033: public.crosspoint_device_codes is missing (migration 024 not applied).';
  end if;
  if to_regclass('public.crosspoint_documents') is null then
    raise exception 'baseline 033: public.crosspoint_documents is missing (migration 025 not applied).';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.replicas'::regclass
      and conname = 'replicas_kind_allowlist'
      and pg_get_constraintdef(oid) like '%custom_translator%'
  ) then
    raise exception 'baseline 033: replicas_kind_allowlist does not allow custom_translator (migration 025 not applied).';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'book_notes' and column_name = 'ink'
  ) then
    raise exception 'baseline 033: book_notes.ink is missing (migration 026 not applied).';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.replicas'::regclass
      and conname = 'replicas_kind_allowlist'
      and pg_get_constraintdef(oid) like '%custom_tts%'
  ) then
    raise exception 'baseline 033: replicas_kind_allowlist does not allow custom_tts (migration 027 not applied).';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'page_count'
  ) then
    raise exception 'baseline 033: books.page_count is missing (migration 028 not applied).';
  end if;
  if has_table_privilege('authenticated', 'public.files', 'INSERT') then
    raise exception 'baseline 033: authenticated still has INSERT on public.files (migration 029 not applied).';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'book_configs' and column_name = 'tts_packs'
  ) then
    raise exception 'baseline 033: book_configs.tts_packs is missing (migration 030 not applied).';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books' and column_name = 'original_filename'
  ) then
    raise exception 'baseline 033: books.original_filename is missing (migration 031 not applied).';
  end if;
  if to_regclass('public.vocabulary') is null then
    raise exception 'baseline 033: public.vocabulary is missing (migration 032 not applied).';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.vocabulary'::regclass) then
    raise exception 'baseline 033: RLS is not enabled on public.vocabulary (migration 032 not fully applied).';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vocabulary') < 4 then
    raise exception 'baseline 033: public.vocabulary does not have all four RLS policies (migration 032 not fully applied).';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stat_archives' and policyname = 'stat_archives_select'
  ) then
    raise exception 'baseline 033: stat_archives_select policy is missing (migration 020 not fully applied).';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'book_notes' and column_name = 'crosspoint'
  ) then
    raise exception 'baseline 033: book_notes.crosspoint is missing (migration 033 not applied).';
  end if;
end $$;
SQL
}

psql_db <<'SQL'
create schema if not exists readest_meta;
create table if not exists readest_meta.migrations (
  name text primary key,
  applied_at timestamp with time zone not null default now()
);
SQL

echo "target: $(psql_db -tAc "select current_database() || ' as ' || current_user")"

ledger_count="$(psql_db -tAc 'select count(*) from readest_meta.migrations')"

if [ "$ledger_count" -eq 0 ]; then
  if [ -z "$MIGRATION_BASELINE" ]; then
    echo "readest_meta.migrations is empty; set MIGRATION_BASELINE to the last" >&2
    echo "already-applied file (e.g., 018_add_metadata_updated_at.sql)." >&2
    exit 1
  fi

  case "$MIGRATION_BASELINE" in
    018_add_metadata_updated_at.sql) verify_baseline_018 ;;
    022_add_group_updated_at.sql) verify_baseline_022 ;;
    033_add_book_notes_crosspoint.sql) verify_baseline_033 ;;
    *)
      echo "Unsupported MIGRATION_BASELINE: $MIGRATION_BASELINE" >&2
      echo "Supported: 018_add_metadata_updated_at.sql, 022_add_group_updated_at.sql, 033_add_book_notes_crosspoint.sql." >&2
      echo "If the database is at another migration, inspect it and seed readest_meta.migrations manually." >&2
      exit 1
      ;;
  esac

  echo "Empty migration ledger; baselining through $MIGRATION_BASELINE"
  for sql in "${migrations[@]}"; do
    name="$(basename "$sql")"
    if [[ "$name" > "$MIGRATION_BASELINE" ]]; then
      continue
    fi
    echo "baseline: $name"
  done

  # One transaction: a cancelled runner must not leave a partial baseline, or
  # the next run would skip the baseline branch and replay 001-018.
  {
    echo "begin;"
    for sql in "${migrations[@]}"; do
      name="$(basename "$sql")"
      if [[ "$name" > "$MIGRATION_BASELINE" ]]; then
        continue
      fi
      printf "insert into readest_meta.migrations (name) values (%s) on conflict (name) do nothing;\n" "$(sql_literal "$name")"
    done
    echo "commit;"
  } | psql_db
else
  if [ -n "$MIGRATION_BASELINE" ]; then
    echo "Migration ledger already has rows; ignoring MIGRATION_BASELINE=$MIGRATION_BASELINE."
  fi
fi

applied=0
skipped=0
for sql in "${migrations[@]}"; do
  [ -f "$sql" ] || continue
  name="$(basename "$sql")"

  if [ -n "$(psql_db -tAc "select 1 from readest_meta.migrations where name = $(sql_literal "$name")")" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  if is_non_transactional "$sql"; then
    echo "applying (non-transactional): $name"
    psql_db -f "$sql"
    psql_db -c "insert into readest_meta.migrations (name) values ($(sql_literal "$name"))" >/dev/null
  else
    echo "applying: $name"
    {
      echo "begin;"
      cat "$sql"
      printf '\n;\n'
      printf "insert into readest_meta.migrations (name) values (%s);\n" "$(sql_literal "$name")"
      echo "commit;"
    } | psql_db
  fi
  applied=$((applied + 1))
done

psql_db -c "notify pgrst, 'reload schema';" >/dev/null

echo "migrations complete: applied=$applied skipped=$skipped"

# 032 creates public.vocabulary but relies on Supabase's default table grants.
# Those defaults differ between projects and are being tightened, so verify the
# role the API uses instead of assuming. Do not grant automatically.
vocab_ok="$(psql_db -tAc "
  select case
    when to_regclass('public.vocabulary') is null then 'missing'
    when has_table_privilege('authenticated', 'public.vocabulary', 'SELECT')
     and has_table_privilege('authenticated', 'public.vocabulary', 'INSERT')
     and has_table_privilege('authenticated', 'public.vocabulary', 'UPDATE')
    then 'ok' else 'missing' end
")"
if [ "$vocab_ok" != "ok" ]; then
  echo "ERROR: public.vocabulary is missing or the authenticated role lacks table privileges." >&2
  echo "The /api/sync/vocabulary route uses the authenticated role. Run this in the SQL editor, then re-run the workflow:" >&2
  echo "  grant select, insert, update, delete on public.vocabulary to authenticated;" >&2
  exit 1
fi

# 016's backfill was skipped by the hosted init file. If the table was not
# empty at that time, incremental pull can skip those rows. Warn; do not mutate
# data, and never run a bulk UPDATE with the books_set_synced_at trigger active
# (it would stamp now() over updated_at).
if [ "$applied" -gt 0 ] || [ "$ledger_count" -eq 0 ]; then
  synced_null="$(psql_db -tAc 'select count(*) from public.books where synced_at is null')"
  if [ "${synced_null:-0}" -gt 0 ]; then
    echo "::warning::public.books has ${synced_null} row(s) with synced_at IS NULL; incremental pull may skip them. Backfill only with the books_set_synced_at trigger disabled."
  fi
fi
