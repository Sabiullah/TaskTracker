#!/usr/bin/env python
"""
Step 1: Export Supabase PostgreSQL schema to JSON.

Usage:
    python supabase_migration/1_export_supabase_schema.py

Requires SUPABASE_DB_URL in .env:
    SUPABASE_DB_URL=postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres

Output: supabase_migration/schemas/supabase_schema.json
"""

import json
import os
import sys
from pathlib import Path
from typing import Any, cast

ROOT = Path(__file__).parent.parent

# Load .env
env_file = ROOT / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())

SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL")
if not SUPABASE_DB_URL:
    print("ERROR: SUPABASE_DB_URL not set.")
    print("Add to your .env file:")
    print("  SUPABASE_DB_URL=postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres")
    sys.exit(1)

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 not installed.")
    print("Run: uv add psycopg2-binary")
    sys.exit(1)

print("Connecting to Supabase...")
conn = psycopg2.connect(SUPABASE_DB_URL, cursor_factory=psycopg2.extras.RealDictCursor)
cur = conn.cursor()

# Tables in public schema
cur.execute("""
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
""")
tables = [cast(dict[str, Any], row)["table_name"] for row in cur.fetchall()]

schema: dict[str, dict[str, Any]] = {}
for table in tables:
    # Columns
    cur.execute(
        """
        SELECT
            column_name,
            data_type,
            udt_name,
            is_nullable,
            column_default,
            character_maximum_length,
            ordinal_position
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position
    """,
        (table,),
    )
    columns = [dict(row) for row in cur.fetchall()]

    # Primary keys
    cur.execute(
        """
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = %s
          AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position
    """,
        (table,),
    )
    primary_keys = [cast(dict[str, Any], row)["column_name"] for row in cur.fetchall()]

    # Foreign keys
    cur.execute(
        """
        SELECT
            kcu.column_name AS from_col,
            ccu.table_name AS to_table,
            ccu.column_name AS to_col
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = %s
          AND tc.constraint_type = 'FOREIGN KEY'
    """,
        (table,),
    )
    foreign_keys = [dict(row) for row in cur.fetchall()]

    # Row count
    cur.execute(f'SELECT COUNT(*) AS cnt FROM "{table}"')
    count_row = cur.fetchone()
    row_count = cast(dict[str, Any], count_row)["cnt"] if count_row is not None else 0

    schema[table] = {
        "columns": columns,
        "primary_keys": primary_keys,
        "foreign_keys": foreign_keys,
        "row_count": row_count,
    }

cur.close()
conn.close()

out_dir = Path(__file__).parent / "schemas"
out_dir.mkdir(exist_ok=True)
out_file = out_dir / "supabase_schema.json"
out_file.write_text(json.dumps(schema, indent=2, default=str))

print(f"\nExported {len(tables)} tables -> {out_file}")
print()
for t, info in schema.items():
    print(f"  {t:40s} {len(info['columns']):3d} cols   {info['row_count']:6d} rows")
