"""Idempotent backfill for display-name fields.

Two operations, both safe to re-run:

1. Populate ``User.full_name`` for any user that still has an empty value.
   Falls back to the username's title-cased form.

2. Rename every ``Master`` of type=team so its ``name`` matches the matching
   User's ``full_name``. The match is ``master.name.lower() == user.username``;
   pre-migration the team masters were seeded with the same short labels the
   users use for login, so this reliably pairs them.

Run on the server once after deploy:

    python manage.py backfill_display_names
"""

from django.core.management.base import BaseCommand

from core.masters.models import Master
from users.models import User


class Command(BaseCommand):
    help = "Backfill User.full_name and rename Team masters to match User full names."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without writing.",
        )

    def handle(self, *args, **options):
        dry = options["dry_run"]

        # 1. Users with empty full_name
        empty_users = list(User.objects.filter(full_name=""))
        self.stdout.write(f"Users with empty full_name: {len(empty_users)}")
        for u in empty_users:
            candidate = (u.username or "").replace(".", " ").title() or u.email
            self.stdout.write(f"  {u.username!r}  ->  {candidate!r}")
            if not dry:
                u.full_name = candidate
                u.save(update_fields=["full_name"])

        # 2. Team masters that should inherit the user's full_name
        user_map = {u.username.lower(): u for u in User.objects.all()}
        changed = 0
        for m in Master.objects.filter(type="team"):
            match = user_map.get(m.name.strip().lower())
            if match and match.full_name and match.full_name != m.name:
                self.stdout.write(f"  master#{m.pk} {m.name!r}  ->  {match.full_name!r}")
                if not dry:
                    m.name = match.full_name
                    m.save(update_fields=["name"])
                changed += 1
        self.stdout.write(f"Team masters renamed: {changed}")

        if dry:
            self.stdout.write(self.style.WARNING("Dry run — no changes written."))
        else:
            self.stdout.write(self.style.SUCCESS("Backfill complete."))
