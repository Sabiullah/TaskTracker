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
    OperationalStandupApproval,
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
        from users.models import OrgMembership

        # Visible standups: profiles who share ≥1 org with the caller. Plain
        # employees (no manager rights anywhere) see only their own.
        caller_org_ids = set(user.org_ids())
        manager_org_ids = set(
            user.memberships.filter(role__in=["admin", "manager"]).values_list(
                "org_id", flat=True
            )
        )

        shared_profile_ids = OrgMembership.objects.filter(
            org_id__in=caller_org_ids
        ).values_list("user_id", flat=True)

        qs = OperationalStandup.objects.select_related(
            "profile", "created_by"
        ).prefetch_related(
            "approvals__approved_by", "approvals__reviewed_by", "approvals__org"
        )

        if manager_org_ids:
            qs = qs.filter(profile_id__in=shared_profile_ids)
        else:
            qs = qs.filter(profile=user)

        month = self.request.query_params.get("month")
        if month:
            qs = qs.filter(standup_date__startswith=month)
        single_date = self.request.query_params.get("date")
        if single_date:
            qs = qs.filter(standup_date=single_date)
        profile_uid = self.request.query_params.get("profile_uid")
        if profile_uid:
            qs = qs.filter(profile__uid=profile_uid)
        breakthrough_type = self.request.query_params.get("breakthrough_type")
        if breakthrough_type:
            qs = qs.filter(breakthrough_type=breakthrough_type)
        return qs

    def perform_create(self, serializer):
        from .services.standup import ensure_approvals_for_standup

        user = cast(User, self.request.user)
        profile = serializer.validated_data["profile"]

        # Caller must share at least one org with the target.
        caller_orgs = set(user.org_ids())
        profile_orgs = set(profile.org_ids())
        shared = caller_orgs & profile_orgs
        if not shared:
            raise PermissionDenied("You don't share an org with that user.")

        is_self = profile.pk == user.pk
        is_manager_in_shared = any(user.is_manager_in_id(org_id) for org_id in shared)
        if not is_self and not is_manager_in_shared:
            raise PermissionDenied(
                "You don't have permission to create a row for that user."
            )

        standup = serializer.save(created_by=user)
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

            from users.models import OrgMembership

            user = cast(User, self.request.user)
            shared_profile_ids = OrgMembership.objects.filter(
                org_id__in=user.org_ids()
            ).values_list("user_id", flat=True)
            queryset = OperationalStandup.objects.select_related(
                "profile", "created_by"
            ).filter(profile_id__in=shared_profile_ids)
            lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
            obj = get_object_or_404(
                queryset, **{self.lookup_field: self.kwargs[lookup_url_kwarg]}
            )
            self.check_object_permissions(self.request, obj)
            return obj
        return super().get_object()

    def perform_update(self, serializer):
        user = cast(User, self.request.user)
        instance = cast(OperationalStandup, serializer.instance)

        profile_org_ids = set(instance.profile.org_ids())
        manager_org_ids = set(
            user.memberships.filter(role__in=["admin", "manager"]).values_list(
                "org_id", flat=True
            )
        )
        is_manager_in_any_profile_org = bool(profile_org_ids & manager_org_ids)

        if not is_manager_in_any_profile_org:
            if instance.profile_id != user.pk:
                raise PermissionDenied("You can only edit your own row.")
            if instance.approvals.filter(status="Approved").exists():
                raise PermissionDenied("This row is already approved and locked.")

        standup = serializer.save()
        broadcast(
            "pace-operational-standups",
            "UPDATE",
            OperationalStandupSerializer(standup).data,
        )

    def perform_destroy(self, instance):
        user = cast(User, self.request.user)
        profile_org_ids = set(instance.profile.org_ids())
        admin_org_ids = set(
            user.memberships.filter(role="admin").values_list("org_id", flat=True)
        )
        if not (profile_org_ids & admin_org_ids):
            raise PermissionDenied(
                "Only admins (in one of the profile's orgs) can delete standup rows."
            )
        broadcast(
            "pace-operational-standups",
            "DELETE",
            {"id": instance.pk, "uid": str(instance.uid)},
        )
        instance.delete()

    @action(detail=False, methods=["get"], url_path="roster")
    def roster(self, request):
        from users.models import OrgMembership

        single_date = request.query_params.get("date")
        if not single_date:
            return Response({"detail": "`date` query param required."}, status=400)

        user = cast(User, request.user)
        manager_org_ids = set(
            user.memberships.filter(role__in=["admin", "manager"]).values_list(
                "org_id", flat=True
            )
        )
        caller_org_ids = set(user.org_ids())

        memberships = OrgMembership.objects.filter(
            org_id__in=caller_org_ids,
            user__is_active=True,
            exclude_from_operational_standup=False,
        ).select_related("user")
        if manager_org_ids:
            memberships = memberships.filter(org_id__in=manager_org_ids)
        else:
            memberships = memberships.filter(user=user)

        # Collapse to unique profiles (a member of N orgs becomes one row).
        seen: dict[int, OrgMembership] = {}
        for m in memberships.order_by("user__full_name", "user__email"):
            seen.setdefault(m.user_id, m)

        standups = {
            s.profile_id: s
            for s in OperationalStandup.objects.filter(
                profile_id__in=seen.keys(),
                standup_date=single_date,
            ).prefetch_related(
                "approvals__org", "approvals__approved_by", "approvals__reviewed_by"
            )
        }

        rows = []
        for profile_id, m in seen.items():
            standup = standups.get(profile_id)
            approvals_payload = []
            if standup is not None:
                for ap in standup.approvals.all():
                    approvals_payload.append(
                        {
                            "uid": str(ap.uid),
                            "org_uid": str(ap.org.uid),
                            "org_name": ap.org.name,
                            "status": ap.status,
                            "approved_by": (
                                {
                                    "uid": str(ap.approved_by.uid),
                                    "full_name": ap.approved_by.full_name,
                                }
                                if ap.approved_by
                                else None
                            ),
                            "approved_at": (
                                ap.approved_at.isoformat() if ap.approved_at else None
                            ),
                            "reviewed_by": (
                                {
                                    "uid": str(ap.reviewed_by.uid),
                                    "full_name": ap.reviewed_by.full_name,
                                }
                                if ap.reviewed_by
                                else None
                            ),
                            "reviewed_at": (
                                ap.reviewed_at.isoformat() if ap.reviewed_at else None
                            ),
                            "can_act": ap.org_id in manager_org_ids,
                        }
                    )
            rows.append(
                {
                    "profile": {
                        "id": m.user_id,
                        "uid": str(m.user.uid),
                        "full_name": m.user.full_name,
                        "email": m.user.email,
                    },
                    "entry": (
                        OperationalStandupSerializer(standup).data if standup else None
                    ),
                    "approvals": approvals_payload,
                    "can_edit": (
                        bool(manager_org_ids)
                        or (
                            m.user_id == user.pk
                            and (
                                standup is None
                                or all(
                                    a.status == "Pending" for a in standup.approvals.all()
                                )
                            )
                        )
                    ),
                }
            )
        return Response(rows)

    def _resolve_approval(self, request, instance, *, role_check):
        from core.org_utils import resolve_org

        org_uid = request.data.get("org")
        if not org_uid:
            return None, Response({"detail": "`org` is required."}, status=400)
        org = resolve_org(org_uid)
        if org is None:
            return None, Response({"detail": "Org not found."}, status=400)

        try:
            approval = instance.approvals.select_related("org").get(org=org)
        except OperationalStandupApproval.DoesNotExist:
            return None, Response(
                {"detail": "That org has no approval row for this standup."},
                status=400,
            )

        user = cast(User, request.user)
        if not role_check(user, org):
            raise PermissionDenied("You don't have permission in that org.")
        return approval, None

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, uid=None):
        from django.utils import timezone

        instance = self.get_object()
        approval, err = self._resolve_approval(
            request, instance, role_check=lambda u, o: u.is_manager_in(o)
        )
        if err is not None:
            return err

        if approval.status != "Approved":
            approval.status = "Approved"
            approval.approved_by = request.user
            approval.approved_at = timezone.now()
            approval.save(
                update_fields=["status", "approved_by", "approved_at", "updated_at"]
            )

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
        approval, err = self._resolve_approval(
            request, instance, role_check=lambda u, o: u.is_admin_in(o)
        )
        if err is not None:
            return err

        if approval.reviewed_at is None:
            approval.reviewed_by = request.user
            approval.reviewed_at = timezone.now()
            approval.save(
                update_fields=["reviewed_by", "reviewed_at", "updated_at"]
            )

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

        admin_org_ids = list(
            user.memberships.filter(role="admin").values_list("org_id", flat=True)
        )
        manager_org_ids = list(
            user.memberships.filter(role__in=["admin", "manager"]).values_list(
                "org_id", flat=True
            )
        )

        admin_q = Q(org_id__in=admin_org_ids) & (
            Q(status="Pending") | Q(status="Approved", reviewed_at__isnull=True)
        )
        manager_only_org_ids = [o for o in manager_org_ids if o not in admin_org_ids]
        manager_q = Q(org_id__in=manager_only_org_ids, status="Pending")
        employee_q = (
            Q(standup__profile=user, status="Pending") & ~Q(org_id__in=manager_org_ids)
        )

        count = OperationalStandupApproval.objects.filter(
            admin_q | manager_q | employee_q
        ).count()
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
            pending = OperationalStandupApproval.objects.select_for_update().filter(
                org=org,
                status="Pending",
                standup__standup_date=date_str,
            )
            approved_ids = list(pending.values_list("id", flat=True))
            pending.update(status="Approved", approved_by=user, approved_at=now)

            unreviewed = OperationalStandupApproval.objects.select_for_update().filter(
                org=org,
                reviewed_at__isnull=True,
                standup__standup_date=date_str,
            )
            reviewed_ids = list(unreviewed.values_list("id", flat=True))
            unreviewed.update(reviewed_by=user, reviewed_at=now)

        affected_standup_ids = set(
            OperationalStandupApproval.objects.filter(
                id__in=set(approved_ids) | set(reviewed_ids)
            ).values_list("standup_id", flat=True)
        )
        for s in OperationalStandup.objects.filter(id__in=affected_standup_ids):
            broadcast(
                "pace-operational-standups",
                "UPDATE",
                OperationalStandupSerializer(s).data,
            )

        return Response(
            {"approved_count": len(approved_ids), "reviewed_count": len(reviewed_ids)}
        )
