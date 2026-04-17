import re
from typing import cast

from django.db import IntegrityError, transaction
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.permissions import IsAdmin
from core.realtime import broadcast
from users.models import User

from .models import ClientClassification, PaceChecklist, PaceGoal, PaceGoalReview, PaceMeeting
from .serializers import (
    ClientClassificationSerializer,
    PaceChecklistSerializer,
    PaceGoalReviewSerializer,
    PaceGoalSerializer,
    PaceMeetingSerializer,
)

FY_RE = re.compile(r"^\d{4}-\d{2}$")


class PaceGoalViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = PaceGoalSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        role = user.role
        qs = PaceGoal.objects.select_related("profile", "org", "created_by").filter(org=getattr(user, "org", None))

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

        if role == "admin":
            return qs
        if role == "manager":
            subordinate_ids = list(user.subordinates.values_list("id", flat=True))
            subordinate_ids.append(user.id)
            return qs.filter(profile_id__in=subordinate_ids)
        return qs.filter(profile=user)

    def _check_profile_permission(self, user: User, profile) -> None:
        if user.role == "manager" and profile and profile.pk != user.pk:
            subordinate_ids = set(user.subordinates.values_list("id", flat=True))
            if profile.pk not in subordinate_ids:
                from rest_framework.exceptions import PermissionDenied

                raise PermissionDenied("Managers can only manage goals for themselves or their subordinates.")

    def perform_create(self, serializer):
        user = cast(User, self.request.user)
        profile = serializer.validated_data.get("profile") or user
        self._check_profile_permission(user, profile)
        goal = serializer.save(created_by=user, profile=profile, org=getattr(user, "org", None))
        broadcast("pace-goals", "INSERT", PaceGoalSerializer(goal).data)

    def perform_update(self, serializer):
        user = cast(User, self.request.user)
        instance = serializer.instance
        profile = serializer.validated_data.get("profile", instance.profile if instance else None)
        self._check_profile_permission(user, profile)
        goal = serializer.save()
        broadcast("pace-goals", "UPDATE", PaceGoalSerializer(goal).data)

    def perform_destroy(self, instance):
        broadcast("pace-goals", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=False, methods=["post"], url_path="bulk_create", permission_classes=[IsAdmin])
    def bulk_create(self, request):
        from rest_framework.exceptions import PermissionDenied

        rows = request.data if isinstance(request.data, list) else request.data.get("rows", [])
        if not isinstance(rows, list):
            return Response({"error": "Expected a list of goal objects"}, status=400)
        user = cast(User, request.user)
        results = []
        for i, row in enumerate(rows):
            s = PaceGoalSerializer(data=row, context={"request": request})
            if s.is_valid():
                profile = s.validated_data.get("profile") or user
                try:
                    self._check_profile_permission(user, profile)
                except PermissionDenied as exc:
                    results.append({"index": i, "status": 403, "errors": {"profile": [str(exc)]}})
                    continue
                goal = s.save(created_by=user, org=getattr(user, "org", None))
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
        qs = PaceGoalReview.objects.select_related("goal", "reviewed_by")
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
        user_org = getattr(self.request.user, "org", None)
        qs = PaceMeeting.objects.select_related("org", "created_by").filter(org=user_org)

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
        user = self.request.user
        meeting = serializer.save(created_by=user, org=getattr(user, "org", None))
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
        user_org = getattr(self.request.user, "org", None)
        qs = PaceChecklist.objects.select_related("org", "updated_by").filter(org=user_org)

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
            return Response({"error": "A checklist item with this week and item number already exists."}, status=400)

    def perform_create(self, serializer):
        user = self.request.user
        item = serializer.save(updated_by=user, org=getattr(user, "org", None))
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
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        user_org = getattr(self.request.user, "org", None)
        qs = ClientClassification.objects.select_related("client", "org", "updated_by").filter(org=user_org)

        client_uid = self.request.query_params.get("client_uid")

        if client_uid:
            qs = qs.filter(client__uid=client_uid)

        return qs

    def perform_create(self, serializer):
        user = self.request.user
        obj = serializer.save(updated_by=user, org=getattr(user, "org", None))
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

        try:
            instance = ClientClassification.objects.get(org=request.user.org, client=client)
            s = ClientClassificationSerializer(instance, data=request.data, partial=True, context={"request": request})
            s.is_valid(raise_exception=True)
            obj = s.save(updated_by=request.user)
            broadcast("client-classifications", "UPDATE", ClientClassificationSerializer(obj).data)
            return Response(s.data)
        except ClientClassification.DoesNotExist:
            s = ClientClassificationSerializer(data=request.data, context={"request": request})
            s.is_valid(raise_exception=True)
            obj = s.save(updated_by=request.user)
            broadcast("client-classifications", "INSERT", ClientClassificationSerializer(obj).data)
            return Response(s.data, status=201)
