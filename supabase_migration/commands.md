# Commands Used — Fresh Migration

## 1. Delete all migration files (keep __init__.py)
```bash
find . -path "*/migrations/*.py" -not -name "__init__.py" ! -path "*/.venv/*" -delete
find . -path "*/migrations/__pycache__" ! -path "*/.venv/*" -exec rm -rf {} + 2>/dev/null
```

## 2. Delete the database
```bash
rm -f db.sqlite3
```

## 3. Create fresh migrations
```bash
uv run python manage.py makemigrations
```

## 4. Apply migrations
```bash
uv run python manage.py migrate
```
