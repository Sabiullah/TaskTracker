from datetime import date

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class StandupBackfillMigrationTests(TransactionTestCase):
    """Verifies 0006_backfill_standup_approvals collapses siblings correctly.

    Uses TransactionTestCase so we can run migrate() forwards/backwards
    without poisoning the shared test database state.
    """

    def setUp(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("pace", "0005_operationalstandupapproval")])
        # Rebuild graph after a reverse so the executor's recorder reflects
        # which migrations are still applied; otherwise the next migrate()
        # call would consider 0006 applied and skip it.
        executor.loader.build_graph()
        self.executor = executor

    def tearDown(self):
        self.executor.loader.build_graph()
        self.executor.migrate(self.executor.loader.graph.leaf_nodes())

    def test_collapses_per_profile_date(self):
        old_state = self.executor.loader.project_state([("pace", "0005_operationalstandupapproval")])
        Org = old_state.apps.get_model("users", "Org")
        User = old_state.apps.get_model("users", "User")
        OrgMembership = old_state.apps.get_model("users", "OrgMembership")
        OperationalStandup = old_state.apps.get_model("pace", "OperationalStandup")

        org_4d = Org.objects.create(name="4D")
        org_ybv = Org.objects.create(name="YBV")
        alice = User.objects.create(email="a@x.com", full_name="Alice", username="alice")
        OrgMembership.objects.create(user=alice, org=org_4d, role="employee")
        OrgMembership.objects.create(user=alice, org=org_ybv, role="employee")
        d = date(2026, 5, 4)
        OperationalStandup.objects.create(
            org=org_4d,
            profile=alice,
            standup_date=d,
            priorities="From 4D",
            status="Approved",
        )
        OperationalStandup.objects.create(
            org=org_ybv,
            profile=alice,
            standup_date=d,
            priorities="From YBV",
            status="Pending",
        )

        self.executor.migrate([("pace", "0006_backfill_standup_approvals")])

        new_state = self.executor.loader.project_state([("pace", "0006_backfill_standup_approvals")])
        OperationalStandup = new_state.apps.get_model("pace", "OperationalStandup")
        OperationalStandupApproval = new_state.apps.get_model("pace", "OperationalStandupApproval")

        rows = list(OperationalStandup.objects.filter(profile_id=alice.id))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].priorities, "From 4D")

        approvals = {a.org_id: a for a in OperationalStandupApproval.objects.all()}
        self.assertEqual(approvals[org_4d.id].status, "Approved")
        self.assertEqual(approvals[org_ybv.id].status, "Pending")
