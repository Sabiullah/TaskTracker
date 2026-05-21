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
        qs = OperationalStandup.objects.select_related("org", "profile", "created_by", "approved_by")

        # Build per-org visibility: in orgs where the user is admin/manager,
        # they see every row; in orgs where they're a plain employee, only
        # their own rows.
        manager_org_ids = list(user.memberships.filter(role__in=["admin", "manager"]).values_list("org_id", flat=True))
        employee_org_ids = list(user.memberships.filter(role="employee").values_list("org_id", flat=True))

        from django.db.models import Q

        visibility = Q(org_id__in=manager_org_ids) | (Q(org_id__in=employee_org_ids) & Q(profile=user))
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

    def _resolve_target_org(self, profile, request):
        """Pick the org to write the row in: payload `org`, else the single org
        the *target profile* shares with the caller."""
        org_uid = request.data.get("org")
        if org_uid:
            from core.org_utils import resolve_org

            return resolve_org(org_uid)
        caller = cast(User, request.user)
        caller_org_ids = set(caller.org_ids())
        target_org_ids = set(profile.org_ids())
        shared = caller_org_ids & target_org_ids
        if len(shared) == 1:
            from users.models import Org

            return Org.objects.filter(pk=shared.pop()).first()
        return None

    def perform_create(self, serializer):
        from django.utils import timezone

        from .services.standup import ensure_approvals_for_standup

        user = cast(User, self.request.user)
        profile = serializer.validated_data["profile"]
        org = self._resolve_target_org(profile, self.request)
        if org is None:
            raise PermissionDenied(
                "Could not determine target org. Pass `org` explicitly when "
                "you and the target profile share more than one org."
            )

        # Caller must belong to the target org.
        if org.pk not in set(user.org_ids()):
            raise PermissionDenied("You don't belong to that org.")

        # Employees can only create their own row.
        is_self = profile.pk == user.pk
        is_manager = user.is_manager_in(org)  # admin OR manager
        if not is_self and not is_manager:
            raise PermissionDenied("You don't have permission to create a row for that user.")

        if is_manager:
            standup = serializer.save(
                org=org,
                created_by=user,
                status="Approved",
                approved_by=user,
                approved_at=timezone.now(),
            )
        else:
            standup = serializer.save(org=org, created_by=user, status="Pending")

        ensure_approvals_for_standup(standup, creator=user)

        broadcast(
            "pace-operational-standups",
            "INSERT",
            OperationalStandupSerializer(standup).data,
        )

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except IntegrityError:
            return Response(
                {"detail": "A standup already exists for that employee on that date."},
                status=400,
            )

    def get_object(self):
        # For write actions (update/partial_update/destroy), bypass the
        # visibility filter so that permission denials surface as 403 rather
        # than 404. The action methods (perform_update / perform_destroy)
        # enforce role-based permissions explicitly.
        if self.action in {"update", "partial_update", "destroy"}:
            from rest_framework.generics import get_object_or_404

            queryset = OperationalStandup.objects.select_related("org", "profile", "created_by", "approved_by").filter(
                org_id__in=cast(User, self.request.user).org_ids()
            )
            lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
            obj = get_object_or_404(queryset, **{self.lookup_field: self.kwargs[lookup_url_kwarg]})
            self.check_object_permissions(self.request, obj)
            return obj
        return super().get_object()

    def perform_update(self, serializer):
        user = cast(User, self.request.user)
        instance = cast(OperationalStandup, serializer.instance)
        is_manager = user.is_manager_in(instance.org)

        # Employees can only edit their own rows, and only while Pending.
        if not is_manager:
            if instance.profile_id != user.pk:
                raise PermissionDenied("You can only edit your own row.")
            if instance.status == "Approved":
                raise PermissionDenied("This row is already approved and locked.")

        standup = serializer.save()
        broadcast(
            "pace-operational-standups",
            "UPDATE",
            OperationalStandupSerializer(standup).data,
        )

    def perform_destroy(self, instance):
        user = cast(User, self.request.user)
        if not user.is_admin_in(instance.org):
            raise PermissionDenied("Only admins can delete standup rows.")
        broadcast(
            "pace-operational-standups",
            "DELETE",
            {"id": instance.pk, "uid": str(instance.uid)},
        )
        instance.delete()

    @action(detail=False, methods=["get"], url_path="roster")
    def roster(self, request):
        single_date = request.query_params.get("date")
        if not single_date:
            return Response({"detail": "`date` query param required."}, status=400)

        user = cast(User, request.user)
        from users.models import OrgMembership

        # For employees, only themselves; for managers/admins, full roster.
        manager_org_ids = set(user.memberships.filter(role__in=["admin", "manager"]).values_list("org_id", flat=True))

        memberships = OrgMembership.objects.filter(
            org_id__in=user.org_ids(),
            user__is_active=True,
            exclude_from_operational_standup=False,
        ).select_related("user", "org")
        # Employees see only themselves in orgs where they aren't manager/admin.
        from django.db.models import Q

        memberships = memberships.filter(Q(org_id__in=manager_org_ids) | Q(user=user))

        # Stable order: org name then full_name.
        memberships = memberships.order_by("org__name", "user__full_name", "user__email")

        entries_by_key = {
            (s.org_id, s.profile_id): s
            for s in OperationalStandup.objects.filter(
                org_id__in=user.org_ids(),
                standup_date=single_date,
            )
        }

        rows = []
        for m in memberships:
            entry = entries_by_key.get((m.org_id, m.user_id))
            rows.append(
                {
                    "profile": {
                        "id": m.user_id,
                        "uid": str(m.user.uid),
                        "full_name": m.user.full_name,
                        "email": m.user.email,
                    },
                    "org_uid": str(m.org.uid),
                    "org_name": m.org.name,
                    "entry": OperationalStandupSerializer(entry).data if entry else None,
                    "can_edit": (
                        m.org_id in manager_org_ids
                        or (m.user_id == user.pk and (entry is None or entry.status == "Pending"))
                    ),
                    "can_approve": m.org_id in manager_org_ids,
                }
            )
        return Response(rows)

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, uid=None):
        from django.utils import timezone

        instance = self.get_object()
        user = cast(User, request.user)
        if not user.is_manager_in(instance.org):
            raise PermissionDenied("Only managers and admins can approve standups.")

        if instance.status != "Approved":
            instance.status = "Approved"
            instance.approved_by = user
            instance.approved_at = timezone.now()
            instance.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])

        broadcast(
            "pace-operational-standups",
            "UPDATE",
            OperationalStandupSerializer(instance).data,
        )
        return Response(OperationalStandupSerializer(instance).data)

    @action(detail=True, methods=["post"], url_path="review")
    def review(self, request, uid=None):
        from django.utils import timezone

        instance = self.get_object()
        user = cast(User, request.user)
        if not user.is_admin_in(instance.org):
            raise PermissionDenied("Only admins can review standups.")

        if instance.reviewed_at is None:
            instance.reviewed_by = user
            instance.reviewed_at = timezone.now()
            instance.save(update_fields=["reviewed_by", "reviewed_at", "updated_at"])

        broadcast(
            "pace-operational-standups",
            "UPDATE",
            OperationalStandupSerializer(instance).data,
        )
        return Response(OperationalStandupSerializer(instance).data)

    @action(detail=False, methods=["get"], url_path="pending_count")
    def pending_count(self, request):
        user = cast(User, request.user)
        from django.db.models import Q

        admin_org_ids = list(user.memberships.filter(role="admin").values_list("org_id", flat=True))
        manager_org_ids = list(user.memberships.filter(role__in=["admin", "manager"]).values_list("org_id", flat=True))

        # Admin attention = Pending OR (Approved AND not reviewed) in admin orgs.
        admin_q = Q(org_id__in=admin_org_ids) & (Q(status="Pending") | Q(status="Approved", reviewed_at__isnull=True))
        # Manager attention = Pending in manager (non-admin) orgs.
        manager_only_org_ids = [o for o in manager_org_ids if o not in admin_org_ids]
        manager_q = Q(org_id__in=manager_only_org_ids, status="Pending")
        # Employee = own Pending rows in non-manager orgs.
        employee_q = Q(profile=user, status="Pending") & ~Q(org_id__in=manager_org_ids)

        count = OperationalStandup.objects.filter(admin_q | manager_q | employee_q).count()
        return Response({"count": count})

    @action(detail=False, methods=["post"], url_path="bulk_review")
    def bulk_review(self, request):
        from django.utils import timezone

        from core.org_utils import resolve_org

        date_str = request.data.get("date")
        org_ident = request.data.get("org")
        if not date_str or not org_ident:
            return Response({"detail": "`date` and `org` are required."}, status=400)
        org = resolve_org(org_ident)
        if org is None:
            return Response({"detail": "Org not found."}, status=400)

        user = cast(User, request.user)
        if not user.is_admin_in(org):
            raise PermissionDenied("Only admins can run Final Review.")

        now = timezone.now()
        with transaction.atomic():
            pending = OperationalStandup.objects.select_for_update().filter(
                org=org,
                standup_date=date_str,
                status="Pending",
            )
            approved_ids = list(pending.values_list("id", flat=True))
            pending.update(status="Approved", approved_by=user, approved_at=now)

            unreviewed = OperationalStandup.objects.select_for_update().filter(
                org=org,
                standup_date=date_str,
                reviewed_at__isnull=True,
            )
            reviewed_ids = list(unreviewed.values_list("id", flat=True))
            unreviewed.update(reviewed_by=user, reviewed_at=now)

        for row in OperationalStandup.objects.filter(id__in=set(approved_ids) | set(reviewed_ids)):
            broadcast(
                "pace-operational-standups",
                "UPDATE",
                OperationalStandupSerializer(row).data,
            )

        return Response({"approved_count": len(approved_ids), "reviewed_count": len(reviewed_ids)})
