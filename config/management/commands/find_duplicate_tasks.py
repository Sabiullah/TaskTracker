"""
Management command: python manage.py find_duplicate_tasks

Read-only diagnostic. Classifies duplicate child Task rows so we know *how*
they were generated before changing any code or data. Two distinct shapes:

  WITHIN-GOAL  — two children share the same (parent goal, category,
                 target_date). The only way this happens is a check-then-insert
                 race in ``materialize_month`` (two concurrent loads of the
                 same goal+month both see an empty month and both insert) — the
                 dedupe there is not race-safe because there is no DB
                 uniqueness backing it.

  CROSS-GOAL   — two children share the same (client, category, target_date)
                 but live under *different* parent goals. This means two main
                 goals exist for the same client + main-category; each
                 materializes its own subtree and ``materialize_month`` (scoped
                 to one parent) can never see the sibling.

Usage:
    python manage.py find_duplicate_tasks               # summary + samples
    python manage.py find_duplicate_tasks --client "Zara School"
    python manage.py find_duplicate_tasks --limit 50
"""

from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db.models import Count

from core.tasks.models import Task


class Command(BaseCommand):
    help = "Report duplicate child tasks, classified as within-goal vs cross-goal."

    def add_arguments(self, parser):
        parser.add_argument("--client", default=None, help="Filter to one client by display name (icontains).")
        parser.add_argument("--limit", type=int, default=30, help="Max duplicate groups to print per section.")

    def handle(self, *args, **opts):
        limit = opts["limit"]
        children = Task.objects.filter(parent_id__isnull=False)
        if opts["client"]:
            children = children.filter(client__name__icontains=opts["client"])

        self._within_goal(children, limit)
        self.stdout.write("")
        self._cross_goal(children, limit)

    # ------------------------------------------------------------------ #
    def _within_goal(self, children, limit):
        groups = (
            children.values("parent_id", "category_id", "target_date")
            .annotate(c=Count("id"))
            .filter(c__gt=1)
            .order_by("-c")
        )
        total_groups = groups.count()
        extra_rows = sum(g["c"] - 1 for g in groups)
        self.stdout.write(
            self.style.MIGRATE_HEADING("=== WITHIN-GOAL duplicates (same parent + category + target_date) ===")
        )
        self.stdout.write(
            f"groups: {total_groups}   redundant rows: {extra_rows}   (cause: materialize race / no DB uniqueness)"
        )
        for g in groups[:limit]:
            rows = list(
                Task.objects.filter(
                    parent_id=g["parent_id"],
                    category_id=g["category_id"],
                    target_date=g["target_date"],
                ).values_list("id", "description", "status", "completed_date", "remarks")
            )
            desc = rows[0][1] if rows else "?"
            ids = [r[0] for r in rows]
            self.stdout.write(
                f"  parent={g['parent_id']} cat={g['category_id']} date={g['target_date']} x{g['c']} :: {desc!r} ids={ids}"
            )

    # ------------------------------------------------------------------ #
    def _cross_goal(self, children, limit):
        groups = (
            children.values("client_id", "category_id", "target_date")
            .annotate(c=Count("id"), parents=Count("parent_id", distinct=True))
            .filter(c__gt=1, parents__gt=1)
            .order_by("-c")
        )
        total_groups = groups.count()
        self.stdout.write(
            self.style.MIGRATE_HEADING(
                "=== CROSS-GOAL duplicates (same client + category + target_date, different goals) ==="
            )
        )
        self.stdout.write(f"groups: {total_groups}   (cause: two main goals for the same client + main-category)")
        # Roll up which goal-pairs collide, so the user can see the duplicate goals.
        goal_pairs: dict[tuple, set] = defaultdict(set)
        for g in groups[:limit]:
            rows = list(
                Task.objects.filter(
                    client_id=g["client_id"],
                    category_id=g["category_id"],
                    target_date=g["target_date"],
                ).values_list("id", "parent_id", "description")
            )
            desc = rows[0][2] if rows else "?"
            parents = sorted({r[1] for r in rows})
            goal_pairs[tuple(parents)].add(desc)
            self.stdout.write(
                f"  client={g['client_id']} cat={g['category_id']} date={g['target_date']} x{g['c']} across goals={parents} :: {desc!r}"
            )
        if goal_pairs:
            self.stdout.write("")
            self.stdout.write("  Colliding goal sets (these main goals overlap and should be merged/removed):")
            for goalset, descs in sorted(goal_pairs.items()):
                self.stdout.write(
                    f"    goals {list(goalset)} share {len(descs)} subcategories e.g. {sorted(descs)[:3]}"
                )
