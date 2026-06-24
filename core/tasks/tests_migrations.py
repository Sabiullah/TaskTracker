from datetime import date

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.utils import IntegrityError
from django.test import TransactionTestCase


class DedupeChildrenMigrationTests(TransactionTestCase):
    """Verifies 0013 collapses duplicate plan children and 0014 then adds the
    one-child-per-slot constraint.

    TransactionTestCase so we can migrate backwards to 0012 (where the
    constraint does not yet exist), seed duplicates that the live schema
    would reject, then migrate forward through 0013/0014 and assert the
    collapse plus the constraint.

    On PostgreSQL this also guards the migration split itself: doing the
    dedupe DELETEs and the ``CREATE INDEX`` in one transaction raises
    ``cannot CREATE INDEX ... because it has pending trigger events``. Running
    these tests on Postgres (not just CI's sqlite) catches that regression.
    """

    def setUp(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0012_normalize_legacy_status_labels")])
        executor.loader.build_graph()
        self.executor = executor

    def tearDown(self):
        self.executor.loader.build_graph()
        self.executor.migrate(self.executor.loader.graph.leaf_nodes())

    def _models(self, leaf):
        state = self.executor.loader.project_state([("tasks", leaf)])
        return (
            state.apps.get_model("users", "Org"),
            state.apps.get_model("users", "User"),
            state.apps.get_model("masters", "Master"),
            state.apps.get_model("tasks", "Task"),
        )

    def test_collapse_keeps_most_meaningful_row_then_constrains(self):
        Org, User, Master, Task = self._models("0012_normalize_legacy_status_labels")
        org = Org.objects.create(name="Acme")
        User.objects.create(email="u@x.com", full_name="U", username="u")
        client = Master.objects.create(name="C1", type="client", org=org)
        brs = Master.objects.create(name="BRS", type="category", org=org)
        main = Task.objects.create(description="Goal", org=org, client=client, target_date=date(2027, 4, 30))
        d = date(2026, 5, 5)
        # Three duplicates in the same slot. The middle one carries the only
        # human-entered progress (a completion) and must be the survivor even
        # though it is not the lowest id.
        Task.objects.create(
            parent=main, org=org, client=client, description="BRS", category=brs, target_date=d, status="pending"
        )
        completed = Task.objects.create(
            parent=main,
            org=org,
            client=client,
            description="BRS",
            category=brs,
            target_date=d,
            status="completed",
            completed_date=d,
        )
        Task.objects.create(
            parent=main, org=org, client=client, description="BRS", category=brs, target_date=d, status="pending"
        )

        self.executor.migrate([("tasks", "0014_add_slot_constraint")])

        _, _, _, Task2 = self._models("0014_add_slot_constraint")
        survivors = list(Task2.objects.filter(parent_id=main.id, category_id=brs.id, target_date=d))
        self.assertEqual(len(survivors), 1)
        self.assertEqual(survivors[0].id, completed.id)

        # Constraint is live: a fresh duplicate is now rejected by the DB.
        with self.assertRaises(IntegrityError):
            Task2.objects.create(
                parent_id=main.id,
                org_id=org.id,
                client_id=client.id,
                description="BRS",
                category_id=brs.id,
                target_date=d,
                status="pending",
            )

    def test_collapse_ties_keep_lowest_id(self):
        Org, User, Master, Task = self._models("0012_normalize_legacy_status_labels")
        org = Org.objects.create(name="Acme2")
        client = Master.objects.create(name="C2", type="client", org=org)
        brs = Master.objects.create(name="BRS", type="category", org=org)
        main = Task.objects.create(description="Goal", org=org, client=client, target_date=date(2027, 4, 30))
        d = date(2026, 6, 5)
        first = Task.objects.create(
            parent=main, org=org, client=client, description="BRS", category=brs, target_date=d, status="pending"
        )
        Task.objects.create(
            parent=main, org=org, client=client, description="BRS", category=brs, target_date=d, status="pending"
        )

        self.executor.migrate([("tasks", "0014_add_slot_constraint")])

        _, _, _, Task2 = self._models("0014_add_slot_constraint")
        survivors = list(Task2.objects.filter(parent_id=main.id, category_id=brs.id, target_date=d))
        self.assertEqual(len(survivors), 1)
        self.assertEqual(survivors[0].id, first.id)

    def test_0015_collapses_name_duplicates_across_category_masters(self):
        """Two children with the SAME name but DIFFERENT category masters (a
        shape allowed by master_unique_sub: same sub-cat name under two mains)
        slip past the 0014 (parent, category, target_date) constraint. 0015
        collapses them by normalised name, keeping the plan-aligned survivor.
        """
        leaf0 = "0012_normalize_legacy_status_labels"
        state = self.executor.loader.project_state([("tasks", leaf0)])
        Org = state.apps.get_model("users", "Org")
        Master = state.apps.get_model("masters", "Master")
        Task = state.apps.get_model("tasks", "Task")
        Plan = state.apps.get_model("tasks", "TaskSubcategoryPlan")

        org = Org.objects.create(name="NameDup")
        client = Master.objects.create(name="C3", type="client", org=org)
        main_a = Master.objects.create(name="Compliance", type="category", org=org)
        main_b = Master.objects.create(name="Book Keeping", type="category", org=org)
        sub_a = Master.objects.create(name="TDS Payment", type="category", org=org, parent=main_a)
        sub_b = Master.objects.create(name="TDS Payment", type="category", org=org, parent=main_b)
        goal = Task.objects.create(description="Goal", org=org, client=client, target_date=date(2027, 4, 30))
        Plan.objects.create(main_task=goal, subcategory=sub_a, recurrence="monthly", active_from_month=date(2026, 6, 1))
        d = date(2026, 6, 7)
        aligned = Task.objects.create(
            parent=goal,
            org=org,
            client=client,
            description="TDS Payment",
            category=sub_a,
            target_date=d,
            status="pending",
        )
        Task.objects.create(
            parent=goal,
            org=org,
            client=client,
            description="TDS Payment",
            category=sub_b,
            target_date=d,
            status="pending",
        )

        self.executor.migrate([("tasks", "0015_collapse_name_duplicate_children")])

        _, _, _, Task2 = self._models("0015_collapse_name_duplicate_children")
        survivors = list(Task2.objects.filter(parent_id=goal.id, target_date=d))
        self.assertEqual(len(survivors), 1)
        # plan points at sub_a, so the sub_a child is the survivor.
        self.assertEqual(survivors[0].id, aligned.id)


class BackfillChildPlanFkMigrationTests(TransactionTestCase):
    """0018 backfills Task.plan from the (parent, category) -> plan mapping.

    Children whose (parent, category) pair has a matching master plan get
    linked; manual/legacy one-offs with no matching plan stay plan=NULL.
    """

    def setUp(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0017_add_child_plan_fk")])
        executor.loader.build_graph()
        self.executor = executor

    def tearDown(self):
        self.executor.loader.build_graph()
        self.executor.migrate(self.executor.loader.graph.leaf_nodes())

    def test_backfill_links_children_to_matching_plan(self):
        state = self.executor.loader.project_state([("tasks", "0017_add_child_plan_fk")])
        Org = state.apps.get_model("users", "Org")
        Master = state.apps.get_model("masters", "Master")
        Task = state.apps.get_model("tasks", "Task")
        Plan = state.apps.get_model("tasks", "TaskSubcategoryPlan")

        org = Org.objects.create(name="Backfill")
        client = Master.objects.create(name="C9", type="client", org=org)
        cat = Master.objects.create(name="Payroll", type="category", org=org)
        main = Task.objects.create(description="Goal", org=org, client=client, target_date=date(2027, 6, 30))
        plan = Plan.objects.create(
            main_task=main,
            subcategory=cat,
            recurrence="monthly",
            target_day=5,
            active_from_month=date(2026, 7, 1),
        )
        child = Task.objects.create(
            parent=main, org=org, client=client, description="Payroll", category=cat, target_date=date(2026, 7, 5)
        )
        orphan = Task.objects.create(
            parent=main, org=org, client=client, description="Manual one-off", target_date=date(2026, 7, 9)
        )

        self.executor.migrate([("tasks", "0018_backfill_child_plan_fk")])

        _, _, _, _ = (org, client, cat, main)
        state2 = self.executor.loader.project_state([("tasks", "0018_backfill_child_plan_fk")])
        Task2 = state2.apps.get_model("tasks", "Task")
        self.assertEqual(Task2.objects.get(pk=child.pk).plan_id, plan.pk)
        self.assertIsNone(Task2.objects.get(pk=orphan.pk).plan_id)
