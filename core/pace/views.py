import re
from typing import cast

from django.db import IntegrityError, transaction
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_admin_org, resolve_create_org, scoped, visibility_q
from core.permissions import IsAdmin
from core.realtime import broadcast
from users.models import User

from .models import (
    ClientClassification,
    OperationalStandup,
    PaceChecklist,
    PaceGoal,
    PaceGoalReview,
    PaceMeeting,
)
from .serializers import (
    ClientClassificationSerializer,
    OperationalStandupSerializer,
    PaceChecklistSerializer,
    PaceGoalReviewSerializer,
    PaceGoalSerializer,
    PaceMeetingSerializer,
)

FY_RE = re.compile(r"^\d{4}-\d{2}$")


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class PaceGoalViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = PaceGoalSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = PaceGoal.objects.select_related("profile", "org", "created_by").filter(visibility_q(user, "profile"))

        profile_uid = self.request.query_params.get("profile_uid")
        goal_type = self.request.query_params.get("goal_type")
        status = self.request.query_params.get("status")
        priority = self.request.query_params.get("priority")

        if profile_uid:
            qs = qs.filter(profile__uid=profile_uid)
        if goal_type:
            qs = qs.filter(goal_type=goal_type)
        if status:
            qs = qs.filter(status=status)
        if priority:
            qs = qs.filter(priority=priority)
        return qs

    def _check_profile_permission(self, user: User, profile, target_org) -> None:
        """Per-org permission gate for setting a goal's `profile`.

        Acting on your own profile is always allowed. Otherwise, the caller
        must be admin in ``target_org`` OR manager in ``target_org`` with the
        profile listed as their subordinate. The org is passed explicitly
        because one user can have very different rights in each org they
        belong to.
        """
        if profile is None or profile.pk == user.pk:
            return
        if user.is_admin_in(target_org):
            return
        if user.is_manager_in(target_org):
            subordinate_ids = set(user.subordinates.values_list("id", flat=True))
            if profile.pk in subordinate_ids:
                return
        raise PermissionDenied("You don't have permission to manage goals for that profile in this org.")

    def perform_create(self, serializer):
        user = cast(User, self.request.user)
        profile = serializer.validated_data.get("profile") or user

        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)

        self._check_profile_permission(user, profile, org)

        goal = serializer.save(created_by=user, profile=profile, org=org)
        broadcast("pace-goals", "INSERT", PaceGoalSerializer(goal).data)

    def perform_update(self, serializer):
        user = cast(User, self.request.user)
        instance = serializer.instance
        profile = serializer.validated_data.get("profile", instance.profile if instance else None)
        # Edit-time org is whatever the goal already sits in.
        self._check_profile_permission(user, profile, instance.org if instance else None)
        goal = serializer.save()
        broadcast("pace-goals", "UPDATE", PaceGoalSerializer(goal).data)

    def perform_destroy(self, instance):
        broadcast("pace-goals", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=False, methods=["post"], url_path="bulk_create", permission_classes=[IsAdmin])
    def bulk_create(self, request):
        rows = request.data if isinstance(request.data, list) else request.data.get("rows", [])
        if not isinstance(rows, list):
            return Response({"error": "Expected a list of goal objects"}, status=400)

        # Bulk-admin endpoint: caller must be admin of the target org, not
        # merely admin of some other org.
        org, err = resolve_admin_org(request)
        if err is not None:
            return err

        user = cast(User, request.user)
        results = []
        for i, row in enumerate(rows):
            s = PaceGoalSerializer(data=row, context={"request": request})
            if s.is_valid():
                profile = s.validated_data.get("profile") or user
                try:
                    self._check_profile_permission(user, profile, org)
                except PermissionDenied as exc:
                    results.append({"index": i, "status": 403, "errors": {"profile": [str(exc)]}})
                    continue
                goal = s.save(created_by=user, org=org)
                results.append({"index": i, "status": 201, "uid": str(goal.uid)})
            else:
                results.append({"index": i, "status": 400, "errors": s.errors})
        created = sum(1 for r in results if r["status"] == 201)
        failed = len(results) - created
        return Response({"created": created, "failed": failed, "results": results}, status=207)


class PaceGoalReviewViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = PaceGoalReviewSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = PaceGoalReview.objects.select_related("goal", "reviewed_by").filter(goal__org_id__in=user.org_ids())
        goal_uid = self.request.query_params.get("goal_uid")
        goal_id = self.request.query_params.get("goal_id")
        if goal_uid:
            qs = qs.filter(goal__uid=goal_uid)
        elif goal_id:
            try:
                qs = qs.filter(goal_id=int(goal_id))
            except ValueError:
                qs = qs.none()
        return qs

    def perform_create(self, serializer):
        user = cast(User, self.request.user)
        reviewer_name = serializer.validated_data.get("reviewer_name") or str(user)
        with transaction.atomic():
            review = serializer.save(reviewed_by=user, reviewer_name=reviewer_name)
            PaceGoal.objects.filter(pk=review.goal_id).update(current_rating=review.new_rating)
        goal = PaceGoal.objects.get(pk=review.goal_id)
        broadcast("pace-goals", "UPDATE", PaceGoalSerializer(goal).data)
        broadcast("pace-goal-reviews", "INSERT", PaceGoalReviewSerializer(review).data)


class PaceMeetingViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = PaceMeetingSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(PaceMeeting.objects.select_related("org", "created_by"), user)

        meeting_type = self.request.query_params.get("meeting_type")
        status = self.request.query_params.get("status")
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        month = self.request.query_params.get("month")

        if meeting_type:
            qs = qs.filter(meeting_type=meeting_type)
        if status:
            qs = qs.filter(status=status)
        if date_from:
            qs = qs.filter(scheduled_date__gte=date_from)
        if date_to:
            qs = qs.filter(scheduled_date__lte=date_to)
        if month:
            qs = qs.filter(scheduled_date__startswith=month)

        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        meeting = serializer.save(created_by=self.request.user, org=org)
        broadcast("pace-meetings", "INSERT", PaceMeetingSerializer(meeting).data)

    def perform_update(self, serializer):
        meeting = serializer.save()
        broadcast("pace-meetings", "UPDATE", PaceMeetingSerializer(meeting).data)

    def perform_destroy(self, instance):
        broadcast("pace-meetings", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()


class PaceChecklistViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = PaceChecklistSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(PaceChecklist.objects.select_related("org", "updated_by"), user)

        fy = self.request.query_params.get("fy")
        week_number = self.request.query_params.get("week_number")

        if fy:
            if not FY_RE.match(fy):
                return qs.none()
            qs = qs.filter(fy=fy)
        if week_number:
            qs = qs.filter(week_number=week_number)

        return qs

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except IntegrityError:
            return Response(
                {"error": "A checklist item with this week and item number already exists."},
                status=400,
            )

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        item = serializer.save(updated_by=self.request.user, org=org)
        broadcast("pace-checklist", "INSERT", PaceChecklistSerializer(item).data)

    def perform_update(self, serializer):
        item = serializer.save(updated_by=self.request.user)
        broadcast("pace-checklist", "UPDATE", PaceChecklistSerializer(item).data)

    def perform_destroy(self, instance):
        broadcast("pace-checklist", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()


class ClientClassificationViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientClassificationSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(
            ClientClassification.objects.select_related("client", "org", "updated_by"),
            user,
        )
        client_uid = self.request.query_params.get("client_uid")
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        try:
            obj = serializer.save(updated_by=self.request.user, org=org)
        except IntegrityError as err:
            raise ValidationError({"detail": "This client already has a classification in this org."}) from err
        broadcast("client-classifications", "INSERT", ClientClassificationSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save(updated_by=self.request.user)
        broadcast("client-classifications", "UPDATE", ClientClassificationSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("client-classifications", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=False, methods=["post"], url_path="upsert")
    def upsert(self, request):
        from core.masters.models import Master

        client_uid = request.data.get("client")
        if not client_uid:
            return Response({"error": "client uid is required"}, status=400)
        try:
            client = Master.objects.get(uid=client_uid, type="client")
        except Master.DoesNotExist:
            return Response({"error": "client not found"}, status=404)

        org, err = resolve_create_org(request)
        if err is not None:
            return err

        try:
            instance = ClientClassification.objects.get(org=org, client=client)
            s = ClientClassificationSerializer(instance, data=request.data, partial=True, context={"request": request})
            s.is_valid(raise_exception=True)
            obj = s.save(updated_by=request.user)
            broadcast("client-classifications", "UPDATE", ClientClassificationSerializer(obj).data)
            return Response(s.data)
        except ClientClassification.DoesNotExist:
            s = ClientClassificationSerializer(data=request.data, context={"request": request})
            s.is_valid(raise_exception=True)
            obj = s.save(updated_by=request.user, org=org, client=client)
            broadcast("client-classifications", "INSERT", ClientClassificationSerializer(obj).data)
            return Response(s.data, status=201)


class OperationalStandupViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = OperationalStandupSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = OperationalStandup.objects.select_related(
            "org", "profile", "created_by", "approved_by"
        )

        # Build per-org visibility: in orgs where the user is admin/manager,
        # they see every row; in orgs where they're a plain employee, only
        # their own rows.
        manager_org_ids = list(
            user.memberships.filter(role__in=["admin", "manager"]).values_list("org_id", flat=True)
        )
        employee_org_ids = list(
            user.memberships.filter(role="employee").values_list("org_id", flat=True)
        )

        from django.db.models import Q
        visibility = Q(org_id__in=manager_org_ids) | (
            Q(org_id__in=employee_org_ids) & Q(profile=user)
        )
        qs = qs.filter(visibility)

        # Filters
        month = self.request.query_params.get("month")
        if month:
            qs = qs.filter(standup_date__startswith=month)
        single_date = self.request.query_params.get("date")
        if single_date:
            qs = qs.filter(standup_date=single_date)
        profile_uid = self.request.query_params.get("profile_uid")
        if profile_uid:
            qs = qs.filter(profile__uid=profile_uid)
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status=status)
        breakthrough_type = self.request.query_params.get("breakthrough_type")
        if breakthrough_type:
            qs = qs.filter(breakthrough_type=breakthrough_type)

        return qs
