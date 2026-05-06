from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import OrgScopedMixin, UserMinSerializer
from users.models import Org

from .models import Task, TaskLog


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


class TaskSerializer(OrgScopedMixin, serializers.ModelSerializer):
    client_detail = MasterMinSerializer(source="client", read_only=True)
    category_detail = MasterMinSerializer(source="category", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    responsible_detail = UserMinSerializer(source="responsible", read_only=True)
    reporting_manager_detail = UserMinSerializer(source="reporting_manager", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    parent = serializers.SlugRelatedField(
        slug_field="uid",
        read_only=True,
        allow_null=True,
    )

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

    def save(self, **kwargs):
        instance = super().save(**kwargs)
        try:
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
            "remarks",
        ]


class TaskWithSubtasksSerializer(TaskSerializer):
    """Wraps ``TaskSerializer`` to upsert a Main + N Subs atomically."""

    subtasks = _SubtaskItemSerializer(many=True, required=False)

    class Meta(TaskSerializer.Meta):
        fields = TaskSerializer.Meta.fields + ["subtasks"]
        read_only_fields = list(TaskSerializer.Meta.read_only_fields)

    def _inheritance(self, main: "Task") -> dict:
        return {
            "org": main.org,
            "client": main.client,
            "reporting_manager": main.reporting_manager,
            "recurrence": main.recurrence,
        }

    def _upsert_subs(self, main: "Task", rows: list[dict]) -> None:
        keep_uids: set[str] = set()
        inherit = self._inheritance(main)
        for row in rows:
            uid = row.pop("uid", None)
            if uid:
                sub = Task.objects.filter(uid=uid, parent=main).first()
                if sub is None:
                    raise serializers.ValidationError({"subtasks": f"Sub uid {uid} does not belong to this goal."})
                for k, v in row.items():
                    setattr(sub, k, v)
                for k, v in inherit.items():
                    setattr(sub, k, v)
                sub.full_clean()
                sub.save()
                keep_uids.add(str(sub.uid))
            else:
                sub = Task(parent=main, **row, **inherit)
                sub.full_clean()
                sub.save()
                keep_uids.add(str(sub.uid))
        Task.objects.filter(parent=main).exclude(uid__in=keep_uids).delete()

    def create(self, validated_data):
        subs = validated_data.pop("subtasks", [])
        with transaction.atomic():
            main = super().create(validated_data)
            if subs:
                self._upsert_subs(main, subs)
        return main

    def update(self, instance, validated_data):
        subs = validated_data.pop("subtasks", None)
        with transaction.atomic():
            main = super().update(instance, validated_data)
            if subs is not None:
                self._upsert_subs(main, subs)
            main.full_clean()
        return main
