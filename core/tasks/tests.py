import datetime as dt

from django.core.exceptions import ValidationError
from django.test import TestCase

from core.masters.models import Master
from core.tasks.models import Task
from users.models import Org, OrgMembership, User


def _setup():
    org = Org.objects.create(name="Acme")
    user = User.objects.create_user(username="u1", password="pw", full_name="U One")
    OrgMembership.objects.create(user=user, org=org, role="admin")
    client = Master.objects.create(name="C1", type="client", org=org)
    return org, user, client


class TaskParentFieldTests(TestCase):
    def test_task_has_nullable_parent_defaulting_to_null(self):
        org, user, client = _setup()
        t = Task.objects.create(
            description="Main",
            org=org,
            client=client,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
        )
        self.assertIsNone(t.parent)

    def test_subtask_links_to_parent_via_parent_fk(self):
        org, user, client = _setup()
        main = Task.objects.create(
            description="Main",
            org=org,
            client=client,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
        )
        sub = Task.objects.create(
            description="Sub",
            org=org,
            client=client,
            reporting_manager=user,
            responsible=user,
            parent=main,
            target_date=dt.date(2026, 5, 1),
        )
        self.assertEqual(sub.parent_id, main.pk)
        self.assertEqual(list(main.subtasks.all()), [sub])

    def test_deleting_main_cascades_to_subs(self):
        org, user, client = _setup()
        main = Task.objects.create(
            description="Main",
            org=org,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
        )
        Task.objects.create(
            description="Sub",
            org=org,
            reporting_manager=user,
            responsible=user,
            parent=main,
        )
        main.delete()
        self.assertEqual(Task.objects.count(), 0)


class TaskValidationTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client = _setup()
        self.main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client,
            reporting_manager=self.user,
            target_date=dt.date(2026, 6, 1),
        )

    def test_sub_target_date_after_parent_target_is_rejected(self):
        sub = Task(
            description="Sub",
            org=self.org,
            client=self.client,
            reporting_manager=self.user,
            responsible=self.user,
            parent=self.main,
            target_date=dt.date(2026, 7, 1),
        )
        with self.assertRaises(ValidationError) as ctx:
            sub.full_clean()
        self.assertIn("main goal's target date", str(ctx.exception))

    def test_sub_target_date_on_or_before_parent_target_is_ok(self):
        sub = Task(
            description="Sub",
            org=self.org,
            client=self.client,
            reporting_manager=self.user,
            responsible=self.user,
            parent=self.main,
            target_date=dt.date(2026, 6, 1),
        )
        sub.full_clean()  # no exception

    def test_grandchild_is_rejected(self):
        sub = Task.objects.create(
            description="Sub",
            org=self.org,
            client=self.client,
            reporting_manager=self.user,
            responsible=self.user,
            parent=self.main,
        )
        grand = Task(
            description="Grand",
            org=self.org,
            client=self.client,
            reporting_manager=self.user,
            responsible=self.user,
            parent=sub,
        )
        with self.assertRaises(ValidationError) as ctx:
            grand.full_clean()
        self.assertIn("Sub-tasks cannot have sub-tasks", str(ctx.exception))

    def test_sub_expected_date_can_exceed_parent_target(self):
        sub = Task(
            description="Sub",
            org=self.org,
            client=self.client,
            reporting_manager=self.user,
            responsible=self.user,
            parent=self.main,
            target_date=dt.date(2026, 5, 1),
            expected_date=dt.date(2026, 7, 15),
        )
        sub.full_clean()  # no exception


class TaskMainShrinkageTests(TestCase):
    def test_moving_main_target_earlier_than_existing_subs_is_rejected(self):
        org, user, client = _setup()
        main = Task.objects.create(
            description="Main",
            org=org,
            client=client,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
        )
        Task.objects.create(
            description="Sub1",
            org=org,
            client=client,
            reporting_manager=user,
            responsible=user,
            parent=main,
            target_date=dt.date(2026, 5, 28),
        )
        main.target_date = dt.date(2026, 5, 1)
        with self.assertRaises(ValidationError) as ctx:
            main.full_clean()
        self.assertIn("sub-task", str(ctx.exception).lower())
