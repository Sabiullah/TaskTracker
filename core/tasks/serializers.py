from typing import cast

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import OrgScopedMixin, UserMinSerializer
from core.tasks.models import TaskSubcategoryPlan
from core.tasks.services import _normalize_recurrence, materialize_engagement, materialize_month
from users.models import Org, User

from .models import Task, TaskLog


def _first_of_month_or_today(d):
    """Snap a date (or ``None``) to the first of its month.

    Used to seed a plan's ``active_from_month`` when the parent goal
    has no engagement start yet — falling back to the first of the
    current month keeps materialisation deterministic.
    """
    import datetime as _dt

    from django.utils.timezone import localdate

    if d is None:
        return localdate().replace(day=1)
    if isinstance(d, _dt.date):
        return d.replace(day=1)
    return localdate().replace(day=1)


def _derive_status_from_dates(completed_date, target_date, current_status: str) -> str:
    """Align ``status`` with the date pair so ``Task.clean()`` accepts the row.

    Mirrors the frontend's ``computeStatus`` for the completed/completed_delay
    transition. Used by both the nested sub-task upsert and ``TaskSerializer``
    so any caller that PATCHes ``completed_date`` without sending ``status``
    still ends up with a row that satisfies the model invariant.
    """
    if completed_date:
        if target_date and completed_date > target_date:
            return "completed_delay"
        return "completed"
    # No completed_date — drop a stale completed status from a previous save.
    if current_status in Task.COMPLETED_STATUSES:
        return "pending"
    return current_status


def _derive_sub_status(sub: "Task") -> str:
    """Pick a backing status for a sub-row based on its dates.

    The board's UI computes status from dates on the fly, but the nested
    sub serializer doesn't accept ``status`` from the client. This keeps the
    DB row consistent with the dates the user just set, and — crucially —
    lets ``Task.clean()`` accept ``completed_date`` (which is only valid
    when status is in COMPLETED_STATUSES).
    """
    return _derive_status_from_dates(sub.completed_date, sub.target_date, sub.status)


class TaskLogSerializer(serializers.ModelSerializer):
    changed_by = UserMinSerializer(read_only=True)
    # Writable on create so the frontend can POST ``{"task_uid": "...",
    # "changes": [...]}``. The FK stores the task by pk but we surface/
    # accept the uid the rest of the app speaks.
    task_uid = serializers.SlugRelatedField(
        source="task",
        slug_field="uid",
        queryset=Task.objects.all(),
        write_only=True,
    )

    class Meta:
        model = TaskLog
        fields = [
            "id",
            "task_uid",
            "changed_by",
            "changed_by_name",
            "changed_at",
            "changes",
        ]
        read_only_fields = [
            "id",
            "changed_by",
            "changed_by_name",
            "changed_at",
        ]


class TaskSubcategoryPlanSerializer(serializers.ModelSerializer):
    """Plan-row payload for create/read. Sub-cat / owner accepted as uids."""

    uid = serializers.UUIDField(read_only=True, required=False)
    subcategory = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="category"),
    )
    subcategory_detail = MasterMinSerializer(source="subcategory", read_only=True)
    default_owner = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=get_user_model().objects.all(),
        required=False,
        allow_null=True,
    )
    default_owner_detail = UserMinSerializer(source="default_owner", read_only=True)
    # Recurrence / target_day / window are optional on input — the create
    # path defaults them from the sub-cat master + the goal's engagement
    # window. Required on the model, but the serializer fills them in.
    recurrence = serializers.CharField(required=False, allow_blank=True)
    target_day = serializers.IntegerField(required=False, allow_null=True)
    active_from_month = serializers.DateField(required=False, allow_null=True)
    active_until_month = serializers.DateField(required=False, allow_null=True)

    class Meta:
        model = TaskSubcategoryPlan
        fields = [
            "uid",
            "subcategory",
            "subcategory_detail",
            "recurrence",
            "target_day",
            "default_owner",
            "default_owner_detail",
            "active_from_month",
            "active_until_month",
        ]
        read_only_fields = ["uid", "subcategory_detail", "default_owner_detail"]


class TaskSerializer(OrgScopedMixin, serializers.ModelSerializer):
    client_detail = MasterMinSerializer(source="client", read_only=True)
    category_detail = MasterMinSerializer(source="category", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    responsible_detail = UserMinSerializer(source="responsible", read_only=True)
    reporting_manager_detail = UserMinSerializer(source="reporting_manager", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    parent = serializers.UUIDField(source="parent.uid", read_only=True, allow_null=True)  # type: ignore[assignment]

    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=False,
        allow_null=True,
    )
    category = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="category"),
        required=False,
        allow_null=True,
    )
    org = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Org.objects.all(),
        required=False,
        allow_null=True,
    )
    responsible = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=get_user_model().objects.all(),
        required=False,
        allow_null=True,
    )
    reporting_manager = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=get_user_model().objects.all(),
        required=False,
        allow_null=True,
    )

    def validate_description(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Description is required.")
        return value.strip()

    def validate(self, attrs):
        # Reporting manager is mandatory only when creating a new task.
        # Historical rows can stay empty (model is nullable) and edits to
        # those rows don't have to backfill it.
        if self.instance is None and not attrs.get("reporting_manager"):
            raise serializers.ValidationError({"reporting_manager": "Reporting manager is required."})
        return super().validate(attrs)

    def _reject_past_month_write(self, instance):
        """Block PATCH on a child whose target_date is in a calendar month
        before today's. Past months are read-only history.
        """
        from django.utils.timezone import localdate

        if instance is None or instance.parent_id is None:
            return
        if instance.target_date is None:
            return
        today_first = localdate().replace(day=1)
        instance_first = instance.target_date.replace(day=1)
        if instance_first < today_first:
            raise serializers.ValidationError({"detail": "Past months are read-only; cannot modify this sub-task."})

    def _auto_align_status_with_dates(self) -> None:
        # Inline-edit callers (e.g. dashboard drill-down) PATCH only the
        # fields the user touched — typically ``completed_date`` with no
        # ``status``. Without this, ``Task.clean()`` rejects the row because
        # ``completed_date`` is only valid when status ∈ COMPLETED_STATUSES.
        if "status" in self.validated_data:
            return
        completed_date = self.validated_data.get(
            "completed_date",
            self.instance.completed_date if self.instance else None,
        )
        target_date = self.validated_data.get(
            "target_date",
            self.instance.target_date if self.instance else None,
        )
        current_status = self.instance.status if self.instance else "pending"
        derived = _derive_status_from_dates(completed_date, target_date, current_status)
        if derived != current_status:
            self.validated_data["status"] = derived

    def save(self, **kwargs):
        if self.instance is not None:
            self._reject_past_month_write(self.instance)
        self._auto_align_status_with_dates()
        # Wrap the whole save so Django ValidationError raised from anywhere
        # in the create/update path — including ``full_clean()`` calls inside
        # ``materialize_engagement`` / ``_upsert_subs`` — surfaces as a clean
        # 400 instead of falling through to DRF's default 500 handler.
        try:
            instance = super().save(**kwargs)
            instance.full_clean()
        except DjangoValidationError as e:
            raise serializers.ValidationError(e.message_dict if hasattr(e, "message_dict") else e.messages) from e
        return instance

    class Meta:
        model = Task
        fields = [
            "id",
            "uid",
            "parent",
            "serial_no",
            "title",
            "description",
            "status",
            "recurrence",
            "engagement_start",
            "engagement_end",
            "target_date",
            "expected_date",
            "completed_date",
            "remarks",
            "client",
            "client_detail",
            "category",
            "category_detail",
            "org",
            "org_uid",
            "responsible",
            "responsible_detail",
            "reporting_manager",
            "reporting_manager_detail",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "parent",
            "serial_no",
            "client_detail",
            "category_detail",
            "org_uid",
            "responsible_detail",
            "reporting_manager_detail",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]


class _SubtaskItemSerializer(serializers.ModelSerializer):
    """Sub-row payload — only the per-row fields are writable here.

    Inheritance fields (org, client, reporting_manager, recurrence) are
    copied from the parent at save time by ``TaskWithSubtasksSerializer``.
    """

    uid = serializers.UUIDField(required=False, allow_null=True)
    category = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="category"),
        required=False,
        allow_null=True,
    )
    responsible = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=get_user_model().objects.all(),
        required=False,
        allow_null=True,
    )

    def validate_description(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Sub-task description is required.")
        return value.strip()

    class Meta:
        model = Task
        fields = [
            "uid",
            "description",
            "category",
            "responsible",
            "target_date",
            "expected_date",
            "completed_date",
            "remarks",
        ]


class TaskWithSubtasksSerializer(TaskSerializer):
    """Wraps ``TaskSerializer`` to upsert a Main + N Subs atomically.

    Newer create flow: instead of a flat ``subtasks`` array the client may
    POST ``plans``; the server creates one ``TaskSubcategoryPlan`` row per
    entry and lazily materializes the *current* calendar month's children
    via ``materialize_month``. Both ``subtasks`` and ``plans`` are accepted
    on create — ``plans`` takes precedence; ``subtasks`` remains supported
    so legacy clients keep working until everyone updates.
    """

    subtasks = _SubtaskItemSerializer(many=True, required=False)
    plans = TaskSubcategoryPlanSerializer(many=True, required=False)

    class Meta(TaskSerializer.Meta):
        fields = TaskSerializer.Meta.fields + ["subtasks", "plans"]
        read_only_fields = list(TaskSerializer.Meta.read_only_fields)

    def _inheritance(self, main: "Task") -> dict:
        return {
            "org": main.org,
            "client": main.client,
            "reporting_manager": main.reporting_manager,
            "recurrence": main.recurrence,
        }

    def _viewer(self) -> "User | None":
        request = self.context.get("request")
        if request is None:
            return None
        # ``force_authenticate`` on APIRequestFactory sets ``_force_auth_user``
        # but the underlying WSGIRequest still carries AnonymousUser on
        # ``request.user``. Honour both so serializer-level tests work the
        # same as full view-level tests.
        user = getattr(request, "_force_auth_user", None) or getattr(request, "user", None)
        if user is None or not getattr(user, "is_authenticated", False):
            return None
        return cast(User, user)

    def _can_manage_subs(self, main: "Task") -> bool:
        """Admin/manager in the goal's org may edit every sub. Anyone else
        (employees) is restricted to subs allocated to themselves."""
        viewer = self._viewer()
        if viewer is None:
            return False
        return bool(viewer.is_manager_in(main.org))

    # Fields an employee may not change on a sub allocated to someone else.
    # Description/category/target/responsible are also blocked because they
    # affect the assignee's plan; the rule is "you can only edit YOUR subs".
    _EMPLOYEE_PROTECTED_FIELDS = (
        "description",
        "category",
        "responsible",
        "target_date",
        "expected_date",
        "completed_date",
        "remarks",
    )

    def _enforce_employee_sub_edit(self, sub: "Task | None", row: dict) -> None:
        """Raise if a non-manager caller is trying to change a sub that is
        not assigned to them. New (uid-less) rows are allowed only for the
        caller themselves; existing rows must be unchanged unless the caller
        is the responsible owner.
        """
        viewer = self._viewer()
        if viewer is None:
            raise serializers.ValidationError({"subtasks": "Authentication required."})

        if sub is None:
            # Creating a new sub — employees may only create rows allocated
            # to themselves.
            target = row.get("responsible")
            if target is None or target.pk != viewer.pk:
                raise serializers.ValidationError(
                    {"subtasks": "Employees can only create sub-tasks allocated to themselves."}
                )
            return

        if sub.responsible_id == viewer.pk:
            return  # Owner — free to edit their own row.

        # Not the owner: every protected field in the incoming row must
        # match what's already saved. ``row`` only contains the fields the
        # serializer accepted, so we compare key-by-key.
        for field in self._EMPLOYEE_PROTECTED_FIELDS:
            if field not in row:
                continue
            new_val = row[field]
            cur_val = getattr(sub, field)
            if new_val != cur_val:
                raise serializers.ValidationError(
                    {
                        "subtasks": (
                            f"You can only edit sub-tasks allocated to you. "
                            f"Sub #{sub.serial_no or sub.uid} is allocated to "
                            f"{getattr(sub.responsible, 'full_name', '') or 'someone else'}."
                        )
                    }
                )

    def _upsert_subs(self, main: "Task", rows: list[dict]) -> None:
        keep_uids: set[str] = set()
        inherit = self._inheritance(main)
        can_manage = self._can_manage_subs(main)
        existing_by_uid = {str(s.uid): s for s in Task.objects.filter(parent=main)}

        # The Edit Goal modal is per-month: it sends only the currently-viewed
        # month's sub rows in the PATCH payload. A blanket "delete every sub
        # not in keep_uids" would therefore wipe every other month's history
        # on every save — the user perceives the re-materialized rows on
        # re-open as duplicates. Scope the delete sweep to just the months
        # represented in the payload, so untouched months stay intact.
        payload_months: set[tuple[int, int]] = set()
        for row in rows:
            td = row.get("target_date")
            if td is not None:
                payload_months.add((td.year, td.month))

        for row in rows:
            uid = row.pop("uid", None)
            if uid:
                sub = Task.objects.filter(uid=uid, parent=main).first()
                if sub is None:
                    raise serializers.ValidationError({"subtasks": f"Sub uid {uid} does not belong to this goal."})
                if not can_manage:
                    self._enforce_employee_sub_edit(sub, row)
                for k, v in row.items():
                    setattr(sub, k, v)
                for k, v in inherit.items():
                    setattr(sub, k, v)
                sub.status = _derive_sub_status(sub)
                sub.full_clean()
                sub.save()
                keep_uids.add(str(sub.uid))
            else:
                if not can_manage:
                    self._enforce_employee_sub_edit(None, row)
                sub = Task(parent=main, **row, **inherit)
                sub.status = _derive_sub_status(sub)
                sub.full_clean()
                sub.save()
                keep_uids.add(str(sub.uid))

        # Employees can't delete subs they don't own; managers/admins can
        # delete anything. Compute the set we'd delete and reject early if
        # the caller isn't allowed.
        def _in_payload_month(sub: "Task") -> bool:
            if sub.target_date is None:
                return False
            return (sub.target_date.year, sub.target_date.month) in payload_months

        to_delete = [s for uid_, s in existing_by_uid.items() if uid_ not in keep_uids and _in_payload_month(s)]
        if to_delete and not can_manage:
            viewer = self._viewer()
            blocked = [s for s in to_delete if s.responsible_id != (viewer.pk if viewer else None)]
            if blocked:
                raise serializers.ValidationError({"subtasks": "You can only delete sub-tasks allocated to you."})
        if to_delete:
            Task.objects.filter(parent=main, uid__in=[s.uid for s in to_delete]).delete()

    def _create_plans(self, main: "Task", plan_rows: list[dict]) -> None:
        for row in plan_rows:
            sub_cat = row["subcategory"]
            # ``recurrence`` may arrive Title-cased (the MasterRecurrence
            # space the per-row dropdown speaks); normalise to the Task
            # model's lowercase choices before save or full_clean will
            # reject it.
            raw_rec = row.get("recurrence") or sub_cat.recurrence
            TaskSubcategoryPlan.objects.create(
                main_task=main,
                subcategory=sub_cat,
                recurrence=_normalize_recurrence(raw_rec),
                target_day=row.get("target_day") or sub_cat.target_day,
                default_owner=row.get("default_owner"),
                active_from_month=row.get("active_from_month") or _first_of_month_or_today(main.engagement_start),
                active_until_month=row.get("active_until_month") or main.engagement_end,
            )

    def create(self, validated_data):
        subs = validated_data.pop("subtasks", None)
        plans = validated_data.pop("plans", None)
        with transaction.atomic():
            main = super().create(validated_data)
            if plans:
                self._create_plans(main, plans)
                # Materialize every month in the engagement window so future
                # months light up on the Board immediately. The board's
                # list endpoint doesn't lazy-materialize like the modal's
                # detail endpoint does — without this, future-month columns
                # stay empty until the user opens each month's modal.
                created = materialize_engagement(main)
                if not created:
                    # Open-ended engagement (no end date) — fall back to
                    # current-month materialization; the modal's detail
                    # endpoint will lazy-materialize the rest on view.
                    from django.utils.timezone import localdate

                    materialize_month(main, localdate().replace(day=1))
            elif subs:
                self._upsert_subs(main, subs)
        return main

    def update(self, instance, validated_data):
        subs = validated_data.pop("subtasks", None)
        validated_data.pop("plans", None)
        with transaction.atomic():
            main = super().update(instance, validated_data)
            if subs is not None:
                self._upsert_subs(main, subs)
            main.full_clean()
        return main
