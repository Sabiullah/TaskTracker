#!/usr/bin/env python
"""
Step 2: Export local SQLite schema to JSON.

Usage:
    python supabase_migration/2_export_local_schema.py

Output: supabase_migration/schemas/local_schema.json
"""

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "db.sqlite3"

if not DB_PATH.exists():
    print(f"ERROR: SQLite database not found at {DB_PATH}")
    print("Run migrations first: python manage.py migrate")
    sys.exit(1)

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("""
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
""")
tables = [row["name"] for row in cur.fetchall()]

schema = {}
for table in tables:
    cur.execute(f"PRAGMA table_info('{table}')")
    columns = []
    for col in cur.fetchall():
        columns.append(
            {
                "cid": col["cid"],
                "name": col["name"],
                "type": col["type"],
                "notnull": bool(col["notnull"]),
                "default": col["dflt_value"],
                "pk": bool(col["pk"]),
            }
        )

    cur.execute(f"PRAGMA foreign_key_list('{table}')")
    foreign_keys = []
    for fk in cur.fetchall():
        foreign_keys.append(
            {
                "from_col": fk["from"],
                "to_table": fk["table"],
                "to_col": fk["to"],
            }
        )

    cur.execute(f"SELECT COUNT(*) AS cnt FROM '{table}'")
    row_count = cur.fetchone()["cnt"]

    schema[table] = {
        "columns": columns,
        "foreign_keys": foreign_keys,
        "row_count": row_count,
    }

conn.close()

out_dir = Path(__file__).parent / "schemas"
out_dir.mkdir(exist_ok=True)
out_file = out_dir / "local_schema.json"
out_file.write_text(json.dumps(schema, indent=2, default=str))

print(f"Exported {len(tables)} tables -> {out_file}")
print()
for t, info in schema.items():
    print(f"  {t:50s} {len(info['columns']):3d} cols   {info['row_count']:6d} rows")
