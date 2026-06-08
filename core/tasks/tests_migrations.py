from datetime import date

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.utils import IntegrityError
from django.test import TransactionTestCase


class DedupeChildrenMigrationTests(TransactionTestCase):
    """Verifies 0013 collapses duplicate plan children before adding the
    one-child-per-slot constraint.

    TransactionTestCase so we can migrate backwards to 0012 (where the
    constraint does not yet exist), seed duplicates that the live schema
    would reject, then migrate forward through 0013 and assert the collapse.
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

        self.executor.migrate([("tasks", "0013_dedupe_children_add_slot_constraint")])

        _, _, _, Task2 = self._models("0013_dedupe_children_add_slot_constraint")
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

        self.executor.migrate([("tasks", "0013_dedupe_children_add_slot_constraint")])

        _, _, _, Task2 = self._models("0013_dedupe_children_add_slot_constraint")
        survivors = list(Task2.objects.filter(parent_id=main.id, category_id=brs.id, target_date=d))
        self.assertEqual(len(survivors), 1)
        self.assertEqual(survivors[0].id, first.id)
