#!/usr/bin/env python
"""
Step 3: Migrate data from Supabase to local SQLite using mapping.json.

Usage:
    python supabase_migration/3_import_data.py [--dry-run] [--table TABLE]

Options:
    --dry-run       Fetch and transform data but do not write to local DB
    --table TABLE   Only migrate this specific local_table (can repeat)

Requires:
    - supabase_migration/mapping.json  (you create this with AI help)
    - SUPABASE_DB_URL in .env
    - psycopg2-binary installed (uv add psycopg2-binary)

mapping.json format: see mapping.json.example
"""

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
MIGRATION_DIR = Path(__file__).parent

# ── Load .env ────────────────────────────────────────────────────────────────
env_file = ROOT / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())

# ── Args ─────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Migrate Supabase → local SQLite")
parser.add_argument("--dry-run", action="store_true", help="Do not write to local DB")
parser.add_argument(
    "--table", action="append", dest="tables", metavar="TABLE", help="Only migrate this local_table (repeatable)"
)
args = parser.parse_args()
DRY_RUN: bool = args.dry_run
ONLY_TABLES: set[str] = set(args.tables or [])

# ── Validate inputs ───────────────────────────────────────────────────────────
MAPPING_FILE = MIGRATION_DIR / "mapping.json"
if not MAPPING_FILE.exists():
    print(f"ERROR: {MAPPING_FILE} not found.")
    print("Create it from mapping.json.example using both schema JSONs + AI.")
    sys.exit(1)

SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL")
if not SUPABASE_DB_URL:
    print("ERROR: SUPABASE_DB_URL not set in environment or .env")
    sys.exit(1)

LOCAL_DB = ROOT / "db.sqlite3"
if not LOCAL_DB.exists():
    print(f"ERROR: Local SQLite not found at {LOCAL_DB}")
    sys.exit(1)

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 not installed. Run: uv add psycopg2-binary")
    sys.exit(1)

# ── Load mapping ──────────────────────────────────────────────────────────────
mapping: dict = json.loads(MAPPING_FILE.read_text())
tables_config: list[dict] = sorted(
    [t for t in mapping["tables"] if not t.get("skip", False)],
    key=lambda t: t.get("order", 99),
)

if ONLY_TABLES:
    tables_config = [t for t in tables_config if t["local_table"] in ONLY_TABLES]
    if not tables_config:
        print(f"ERROR: No matching tables found for: {ONLY_TABLES}")
        sys.exit(1)

# ── Connections ───────────────────────────────────────────────────────────────
print("Connecting to Supabase...")
supa_conn = psycopg2.connect(SUPABASE_DB_URL, cursor_factory=psycopg2.extras.RealDictCursor)
supa_cur = supa_conn.cursor()

local_conn = sqlite3.connect(LOCAL_DB)
local_conn.row_factory = sqlite3.Row
local_cur = local_conn.cursor()
local_conn.execute("PRAGMA foreign_keys = OFF")  # disable FK checks during bulk insert


# ── Lookup cache: resolve foreign-key UUIDs → local integer IDs ──────────────
_lookup_cache: dict[str, dict] = {}


def resolve_lookup(value, lookup_cfg: dict):
    """
    lookup_cfg example:
        {"local_table": "users_user", "match_field": "uid"}

    Returns the local integer PK (`id`) for the row where match_field = value.
    Returns None if value is None or not found.
    """
    if value is None:
        return None
    key = f"{lookup_cfg['local_table']}.{lookup_cfg['match_field']}"
    if key not in _lookup_cache:
        local_cur.execute(f'SELECT id, {lookup_cfg["match_field"]} FROM "{lookup_cfg["local_table"]}"')
        _lookup_cache[key] = {str(row["id" if "id" in row.keys() else 0]): row[0] for row in local_cur.fetchall()}
        # Rebuild properly
        local_cur.execute(f'SELECT id, "{lookup_cfg["match_field"]}" FROM "{lookup_cfg["local_table"]}"')
        _lookup_cache[key] = {str(row[1]): row[0] for row in local_cur.fetchall()}
    result = _lookup_cache[key].get(str(value))
    return result


# ── Main migration loop ───────────────────────────────────────────────────────
total_inserted = 0
total_skipped = 0

for tbl_cfg in tables_config:
    supa_table: str = tbl_cfg["supabase_table"]
    local_table: str = tbl_cfg["local_table"]
    field_map: dict = tbl_cfg.get("fields", {})
    lookups: dict = tbl_cfg.get("lookups", {})
    static_fields: dict = tbl_cfg.get("static", {})
    note: str = tbl_cfg.get("note", "")

    print(f"\n{'─' * 60}")
    print(f"  {supa_table}  →  {local_table}{f'  ({note})' if note else ''}")
    print(f"{'─' * 60}")

    # Fetch from Supabase
    supa_cur.execute(f'SELECT * FROM "{supa_table}"')
    rows = supa_cur.fetchall()
    print(f"  Fetched {len(rows)} rows from Supabase")

    if not rows:
        print("  Nothing to import.")
        continue

    # Determine target columns for INSERT
    # Build a sample transformed row to get column names
    inserted = 0
    skipped = 0

    for row in rows:
        row_dict = dict(row)
        local_row: dict = {}

        # Direct field mappings
        for supa_field, field_cfg in field_map.items():
            to_field = field_cfg["to"] if isinstance(field_cfg, dict) else field_cfg
            value = row_dict.get(supa_field)
            # Optional value transform
            if isinstance(field_cfg, dict) and "value_map" in field_cfg:
                value = field_cfg["value_map"].get(str(value), value)
            local_row[to_field] = value

        # FK lookups
        for supa_field, lookup_cfg in lookups.items():
            to_field = lookup_cfg["to"]
            raw_value = row_dict.get(supa_field)
            resolved = resolve_lookup(raw_value, lookup_cfg)
            if raw_value is not None and resolved is None:
                print(
                    f"  WARN: lookup miss for {supa_field}={raw_value!r} → {lookup_cfg['local_table']}.{lookup_cfg['match_field']}"
                )
            local_row[to_field] = resolved

        # Static fields
        local_row.update(static_fields)

        if not local_row:
            skipped += 1
            continue

        cols = list(local_row.keys())
        placeholders = ", ".join("?" * len(cols))
        col_names = ", ".join(f'"{c}"' for c in cols)
        values = [local_row[c] for c in cols]

        if DRY_RUN:
            inserted += 1
            continue

        try:
            local_cur.execute(
                f'INSERT OR IGNORE INTO "{local_table}" ({col_names}) VALUES ({placeholders})',
                values,
            )
            if local_cur.rowcount > 0:
                inserted += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"  ERROR inserting row: {e}")
            print(f"  Row data: {local_row}")
            skipped += 1

    if not DRY_RUN:
        local_conn.commit()

    total_inserted += inserted
    total_skipped += skipped
    label = "would insert" if DRY_RUN else "inserted"
    print(f"  {label}: {inserted}   skipped/existing: {skipped}")


# ── Re-enable FK checks and close ─────────────────────────────────────────────
local_conn.execute("PRAGMA foreign_keys = ON")
local_conn.close()
supa_cur.close()
supa_conn.close()

print(f"\n{'=' * 60}")
if DRY_RUN:
    print("  DRY RUN complete — no data written")
    print(f"  Would insert: {total_inserted}   Would skip: {total_skipped}")
else:
    print("  Migration complete!")
    print(f"  Total inserted: {total_inserted}   Total skipped: {total_skipped}")
print(f"{'=' * 60}")
