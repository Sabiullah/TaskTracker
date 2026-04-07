"""
Management command to seed initial data.

Usage:
    python manage.py loadinitialdata                  # seed everything
    python manage.py loadinitialdata --only tasks     # seed only tasks
    python manage.py loadinitialdata --only users     # seed only team member users
    python manage.py loadinitialdata --clear          # wipe tasks first, then seed
"""

from django.core.management.base import BaseCommand

from core.models import Task
from users.models import User

# ── Master data (mirrors initialData.ts) ─────────────────────────────────────

CLIENTS = [
    "Focus",
    "Ayyan",
    "ER",
    "Naturefull",
    "Apparel",
    "Zara School",
    "JMS",
    "Mizaj",
    "TAW",
    "Lily Aura",
    "London Stores",
    "Kaaba Grand",
    "Insnap",
    "Al Ameen",
    "The Independent Tobacco FZE",
    "AL-Noor",
    "SS Footwear",
    "Moon Mart",
    "Allied",
    "KSM",
]

CATEGORIES = [
    "Accounting",
    "Audit",
    "Tax",
    "Book Review",
    "Health Check",
    "Database",
    "GST",
    "Payroll",
    "Reconciliation",
    "Other",
]

TEAM_MEMBERS = [
    "Tamil",
    "Musthafa",
    "Akilan",
    "Aravind",
    "Safy",
    "Kasturi",
    "Alavudeen",
    "Surya",
]

INITIAL_TASKS = [
    dict(
        s_no=1,
        client="Focus",
        category="Accounting",
        description="Database completion",
        status="Completed",
        target_date="2026-02-15",
        expected_date="2026-02-15",
        comp_date="2026-02-15",
        responsible="Tamil",
        remarks="Completed on schedule",
        recurrence="Onetime",
    ),
    dict(
        s_no=2,
        client="Ayyan",
        category="Audit",
        description="Internal audit review",
        status="Pending",
        target_date="2026-03-01",
        expected_date="2026-03-05",
        comp_date=None,
        responsible="Musthafa",
        remarks="Waiting for client documents",
        recurrence="Onetime",
    ),
    dict(
        s_no=3,
        client="ER",
        category="Tax",
        description="GST submission Q1",
        status="TodayTask",
        target_date="2026-02-28",
        expected_date="2026-02-28",
        comp_date=None,
        responsible="Akilan",
        remarks="Due today - file by 5pm",
        recurrence="Onetime",
    ),
    dict(
        s_no=4,
        client="Naturefull",
        category="Book Review",
        description="Monthly book closure",
        status="Overdue",
        target_date="2026-02-20",
        expected_date="2026-02-25",
        comp_date=None,
        responsible="Aravind",
        remarks="Delayed - client data missing",
        recurrence="Monthly",
    ),
    dict(
        s_no=5,
        client="Apparel",
        category="Health Check",
        description="Financial health assessment",
        status="Future Task/Goals",
        target_date="2026-04-15",
        expected_date="2026-04-30",
        comp_date=None,
        responsible="Safy",
        remarks="Planned for Q2 2026",
        recurrence="Onetime",
    ),
    dict(
        s_no=6,
        client="Zara School",
        category="Accounting",
        description="Annual book review completion",
        status="Completed Delay",
        target_date="2026-02-10",
        expected_date="2026-02-10",
        comp_date="2026-02-18",
        responsible="Kasturi",
        remarks="Completed 8 days late due to data issues",
        recurrence="Yearly",
    ),
    dict(
        s_no=7,
        client="JMS",
        category="Audit",
        description="Statutory audit preparation",
        status="TBC",
        target_date="2026-03-15",
        expected_date=None,
        comp_date=None,
        responsible="Alavudeen",
        remarks="Awaiting client confirmation on dates",
        recurrence="Onetime",
    ),
    dict(
        s_no=8,
        client="Mizaj",
        category="Tax",
        description="Corporate tax filing",
        status="Ontime",
        target_date="2026-02-28",
        expected_date="2026-02-28",
        comp_date=None,
        responsible="Surya",
        remarks="On track for deadline",
        recurrence="Yearly",
    ),
    dict(
        s_no=9,
        client="TAW",
        category="Payroll",
        description="Payroll processing - February",
        status="Pending",
        target_date="2026-03-05",
        expected_date="2026-03-05",
        comp_date=None,
        responsible="Tamil",
        remarks="Waiting for attendance data",
        recurrence="Monthly",
    ),
    dict(
        s_no=10,
        client="Lily Aura",
        category="Book Review",
        description="Q4 2025 book closure",
        status="Completed",
        target_date="2026-02-15",
        expected_date="2026-02-15",
        comp_date="2026-02-14",
        responsible="Musthafa",
        remarks="Completed ahead of schedule",
        recurrence="Quarterly",
    ),
    dict(
        s_no=11,
        client="London Stores",
        category="Audit",
        description="External audit support documentation",
        status="TodayTask",
        target_date="2026-02-28",
        expected_date="2026-02-28",
        comp_date=None,
        responsible="Akilan",
        remarks="Auditor meeting at 3pm today",
        recurrence="Onetime",
    ),
    dict(
        s_no=12,
        client="Kaaba Grand",
        category="Tax",
        description="VAT return filing - Jan 2026",
        status="Overdue",
        target_date="2026-02-15",
        expected_date="2026-02-20",
        comp_date=None,
        responsible="Aravind",
        remarks="Pending client invoice list",
        recurrence="Monthly",
    ),
    dict(
        s_no=13,
        client="Insnap",
        category="Reconciliation",
        description="Bank reconciliation - Q4",
        status="Future Task/Goals",
        target_date="2026-05-01",
        expected_date="2026-05-15",
        comp_date=None,
        responsible="Safy",
        remarks="Planned after Q1 close",
        recurrence="Quarterly",
    ),
    dict(
        s_no=14,
        client="Al Ameen",
        category="Book Review",
        description="Semi-annual financial review",
        status="TBC",
        target_date="2026-03-31",
        expected_date=None,
        comp_date=None,
        responsible="Kasturi",
        remarks="Client to confirm scope",
        recurrence="Quarterly",
    ),
    dict(
        s_no=15,
        client="KSM",
        category="Health Check",
        description="Business health check report",
        status="Ontime",
        target_date="2026-03-10",
        expected_date="2026-03-10",
        comp_date=None,
        responsible="Alavudeen",
        remarks="Draft report in progress",
        recurrence="Onetime",
    ),
    dict(
        s_no=16,
        client="AL-Noor",
        category="Accounting",
        description="Monthly ledger reconciliation",
        status="Completed",
        target_date="2026-02-20",
        expected_date="2026-02-20",
        comp_date="2026-02-19",
        responsible="Surya",
        remarks="Done. No discrepancies.",
        recurrence="Monthly",
    ),
    dict(
        s_no=17,
        client="SS Footwear",
        category="GST",
        description="GST annual return preparation",
        status="Pending",
        target_date="2026-03-20",
        expected_date="2026-03-20",
        comp_date=None,
        responsible="Tamil",
        remarks="Collecting invoices from client",
        recurrence="Yearly",
    ),
    dict(
        s_no=18,
        client="Moon Mart",
        category="Audit",
        description="Inventory audit verification",
        status="Completed Delay",
        target_date="2026-02-12",
        expected_date="2026-02-12",
        comp_date="2026-02-20",
        responsible="Musthafa",
        remarks="Physical count took longer than expected",
        recurrence="Onetime",
    ),
    dict(
        s_no=19,
        client="Allied",
        category="Tax",
        description="Corporate tax computation FY2025",
        status="Pending",
        target_date="2026-03-31",
        expected_date="2026-03-31",
        comp_date=None,
        responsible="Akilan",
        remarks="Pending financials from client",
        recurrence="Yearly",
    ),
    dict(
        s_no=20,
        client="The Independent Tobacco FZE",
        category="Accounting",
        description="Intercompany reconciliation",
        status="TodayTask",
        target_date="2026-02-28",
        expected_date="2026-02-28",
        comp_date=None,
        responsible="Aravind",
        remarks="Final figures needed today",
        recurrence="Monthly",
    ),
]


class Command(BaseCommand):
    help = "Seed initial clients, categories, team members, and tasks"

    def add_arguments(self, parser):
        parser.add_argument(
            "--only",
            choices=["tasks", "users"],
            default=None,
            help="Seed only tasks or only users (default: both)",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete all existing tasks before seeding",
        )

    def handle(self, *args, **options):
        only = options["only"]
        clear = options["clear"]

        if only != "tasks":
            self._seed_users()

        if only != "users":
            if clear:
                count, _ = Task.objects.all().delete()
                self.stdout.write(self.style.WARNING(f"Cleared {count} existing tasks."))
            self._seed_tasks()

        self.stdout.write(self.style.SUCCESS("Done."))

    # ── Users ─────────────────────────────────────────────────────────────────

    def _seed_users(self):
        if not User.objects.filter(role="admin").exists():
            admin_user = User.objects.create_superuser(
                email="admin@tasktracker.local",
                password="admin123",
                username="admin",
                full_name="Admin",
            )
            self.stdout.write(
                self.style.SUCCESS(f"  Created admin user (email: {admin_user.email} / password: admin123)")
            )
        else:
            self.stdout.write("  Admin user already exists — skipped.")

        created = 0
        for name in TEAM_MEMBERS:
            username = name.lower()
            if not User.objects.filter(username=username).exists():
                User.objects.create_user(
                    username=username,
                    password="123456",
                    full_name=name,
                    role="employee",
                )
                created += 1
        self.stdout.write(self.style.SUCCESS(f"  Created {created} team member users (password: 123456)."))
        if created < len(TEAM_MEMBERS):
            self.stdout.write(f"  {len(TEAM_MEMBERS) - created} users already existed — skipped.")

    # ── Tasks ─────────────────────────────────────────────────────────────────

    def _seed_tasks(self):
        admin_user = User.objects.filter(role="admin").first()
        created = 0
        skipped = 0

        for t in INITIAL_TASKS:
            _, was_created = Task.objects.get_or_create(
                s_no=t["s_no"],
                defaults={**t, "created_by": admin_user},
            )
            if was_created:
                created += 1
            else:
                skipped += 1

        self.stdout.write(self.style.SUCCESS(f"  Created {created} tasks."))
        if skipped:
            self.stdout.write(f"  {skipped} tasks already existed — skipped.")
