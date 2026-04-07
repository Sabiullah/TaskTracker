from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import permissions, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.validators import UniqueValidator

from users.models import User

from .models import (
    ChatMember,
    ChatMessage,
    ChatRoom,
    InvoiceEntry,
    InvoicePlan,
    Lead,
    LeadFollowup,
    LeadStatus,
    Notice,
    Task,
    WorkLog,
    WorkPlan,
)

# ── Serializers ───────────────────────────────────────────────────────────────


class TaskSerializer(serializers.ModelSerializer):
    created_by = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Task
        fields = "__all__"


class WorkLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkLog
        fields = "__all__"


class WorkPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkPlan
        fields = "__all__"


class NoticeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notice
        fields = "__all__"


class LeadStatusSerializer(serializers.ModelSerializer):
    name = serializers.CharField(
        max_length=100,
        validators=[
            UniqueValidator(
                queryset=LeadStatus.objects.all(),
                message="A lead status with this name already exists.",
            )
        ],
    )

    class Meta:
        model = LeadStatus
        fields = "__all__"


class LeadFollowupSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeadFollowup
        fields = "__all__"


class LeadSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lead
        fields = "__all__"


class InvoicePlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoicePlan
        fields = "__all__"


class InvoiceEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceEntry
        fields = "__all__"


class ChatMemberSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatMember
        fields = "__all__"


class ChatMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatMessage
        fields = "__all__"


class ChatRoomSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatRoom
        fields = "__all__"


# ── ViewSets ──────────────────────────────────────────────────────────────────


class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Task.objects.all()

    def get_queryset(self):  # type: ignore[override]
        user: User = self.request.user  # type: ignore[assignment]
        role = getattr(user, "role", None)
        qs = Task.objects.all()
        if role == "admin":
            return qs
        if role == "manager":
            team_names = list(user.subordinates.values_list("full_name", flat=True))
            team_names.append(user.full_name or "")
            return qs.filter(responsible__in=team_names)
        return qs.filter(responsible=user.full_name or "")

    def perform_create(self, serializer: TaskSerializer) -> None:  # type: ignore[override]
        serializer.save(created_by=self.request.user)


class WorkLogViewSet(viewsets.ModelViewSet):
    serializer_class = WorkLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = WorkLog.objects.all()

    def get_queryset(self):  # type: ignore[override]
        user: User = self.request.user  # type: ignore[assignment]
        role = getattr(user, "role", None)
        qs = WorkLog.objects.all()
        if role == "admin":
            return qs
        if role == "manager":
            team_names = list(user.subordinates.values_list("full_name", flat=True))
            team_names.append(user.full_name or "")
            return qs.filter(name__in=team_names)
        return qs.filter(name=user.full_name or "")

    def perform_create(self, serializer: WorkLogSerializer) -> None:  # type: ignore[override]
        serializer.save(user=self.request.user)


class WorkPlanViewSet(viewsets.ModelViewSet):
    serializer_class = WorkPlanSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = WorkPlan.objects.all()

    def get_queryset(self):  # type: ignore[override]
        user: User = self.request.user  # type: ignore[assignment]
        role = getattr(user, "role", None)
        qs = WorkPlan.objects.all()
        if role in ("admin", "manager"):
            return qs
        return qs.filter(assigned_to=user.full_name or "")


class NoticeViewSet(viewsets.ModelViewSet):
    serializer_class = NoticeSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Notice.objects.all()

    def perform_create(self, serializer: NoticeSerializer) -> None:  # type: ignore[override]
        serializer.save(created_by=self.request.user)


class LeadStatusViewSet(viewsets.ModelViewSet):
    serializer_class = LeadStatusSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = LeadStatus.objects.all()


class LeadViewSet(viewsets.ModelViewSet):
    serializer_class = LeadSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Lead.objects.all()

    def get_queryset(self):  # type: ignore[override]
        user: User = self.request.user  # type: ignore[assignment]
        role = getattr(user, "role", None)
        qs = Lead.objects.all()
        if role in ("admin", "manager"):
            return qs
        return qs.filter(assigned_to=user.full_name or "")

    def perform_create(self, serializer: LeadSerializer) -> None:  # type: ignore[override]
        serializer.save(created_by=self.request.user)


class LeadFollowupViewSet(viewsets.ModelViewSet):
    serializer_class = LeadFollowupSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = LeadFollowup.objects.all()

    def get_queryset(self):  # type: ignore[override]
        lead_id = self.request.query_params.get("lead_id")  # type: ignore[attr-defined]
        qs = LeadFollowup.objects.all()
        if lead_id:
            qs = qs.filter(lead_id=lead_id)
        return qs

    def perform_create(self, serializer: LeadFollowupSerializer) -> None:  # type: ignore[override]
        serializer.save(created_by=self.request.user)


class InvoicePlanViewSet(viewsets.ModelViewSet):
    serializer_class = InvoicePlanSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = InvoicePlan.objects.all()

    def perform_create(self, serializer: InvoicePlanSerializer) -> None:  # type: ignore[override]
        serializer.save(created_by=self.request.user)


class InvoiceEntryViewSet(viewsets.ModelViewSet):
    serializer_class = InvoiceEntrySerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = InvoiceEntry.objects.all()

    @action(detail=False, methods=["post"], url_path="upload")
    def upload(self, request):
        import os

        from django.conf import settings as django_settings

        entry_id = request.data.get("entry_id")
        invoice_number = request.data.get("invoice_number", "")
        notes = request.data.get("notes", "")
        file = request.FILES.get("file")

        try:
            entry = InvoiceEntry.objects.get(id=entry_id)
        except InvoiceEntry.DoesNotExist:
            return Response({"error": "Entry not found"}, status=404)

        if file:
            upload_dir = getattr(django_settings, "INVOICE_UPLOAD_DIR", django_settings.BASE_DIR / "invoice_uploads")
            os.makedirs(upload_dir, exist_ok=True)
            file_path = os.path.join(str(upload_dir), f"{timezone.now().timestamp()}_{file.name}")
            with open(file_path, "wb") as f:
                for chunk in file.chunks():
                    f.write(chunk)
            entry.file_path = file_path
            entry.file_name = file.name

        entry.invoice_number = invoice_number
        entry.notes = notes
        entry.status = "Uploaded"
        entry.uploaded_by = request.user
        entry.uploaded_at = timezone.now()
        entry.save()
        return Response(InvoiceEntrySerializer(entry).data)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        import os

        entry = self.get_object()
        if not entry.file_path:
            raise Http404("No file attached")
        if not os.path.exists(entry.file_path):
            raise Http404("File not found")
        return FileResponse(open(entry.file_path, "rb"), as_attachment=True, filename=entry.file_name or "invoice")


class ChatRoomViewSet(viewsets.ModelViewSet):
    serializer_class = ChatRoomSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = ChatRoom.objects.all()

    def get_queryset(self):  # type: ignore[override]
        user: User = self.request.user  # type: ignore[assignment]
        # Only return rooms the user is a member of
        return ChatRoom.objects.filter(members__user=user).distinct()

    def perform_create(self, serializer: ChatRoomSerializer) -> None:  # type: ignore[override]
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["get"])
    def messages(self, request, pk=None):
        room = self.get_object()
        msgs = room.messages.all()
        return Response(ChatMessageSerializer(msgs, many=True).data)

    @action(detail=True, methods=["get"])
    def members(self, request, pk=None):
        room = self.get_object()
        return Response(ChatMemberSerializer(room.members.all(), many=True).data)


class ChatMemberViewSet(viewsets.ModelViewSet):
    serializer_class = ChatMemberSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = ChatMember.objects.all()

    def get_queryset(self):  # type: ignore[override]
        user: User = self.request.user  # type: ignore[assignment]
        room_id = self.request.query_params.get("room_id")  # type: ignore[attr-defined]
        qs = ChatMember.objects.filter(room__members__user=user).distinct()
        if room_id:
            qs = qs.filter(room_id=room_id)
        return qs


class ChatMessageViewSet(viewsets.ModelViewSet):
    serializer_class = ChatMessageSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = ChatMessage.objects.all()

    def get_queryset(self):  # type: ignore[override]
        user: User = self.request.user  # type: ignore[assignment]
        room_id = self.request.query_params.get("room_id")  # type: ignore[attr-defined]
        since = self.request.query_params.get("since")  # type: ignore[attr-defined]
        qs = ChatMessage.objects.filter(room__members__user=user).distinct()
        if room_id:
            qs = qs.filter(room_id=room_id)
        if since:
            qs = qs.filter(created_at__gt=since)
        return qs

    def perform_create(self, serializer: ChatMessageSerializer) -> None:  # type: ignore[override]
        # Handle multipart file upload
        request = self.request
        file = request.FILES.get("file")
        if file:
            import os

            from django.conf import settings as django_settings

            upload_dir = getattr(django_settings, "CHAT_UPLOAD_DIR", django_settings.BASE_DIR / "chat_uploads")
            os.makedirs(upload_dir, exist_ok=True)
            file_path = os.path.join(str(upload_dir), f"{timezone.now().timestamp()}_{file.name}")
            with open(file_path, "wb") as f:
                for chunk in file.chunks():
                    f.write(chunk)
            serializer.save(
                sender=request.user,
                file_path=file_path,
                file_name=file.name,
                file_type=file.content_type,
                file_size=file.size,
            )
        else:
            serializer.save(sender=request.user)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        msg = self.get_object()
        if not msg.file_path:
            raise Http404("No file attached")
        import os

        if not os.path.exists(msg.file_path):
            raise Http404("File not found")
        return FileResponse(open(msg.file_path, "rb"), as_attachment=True, filename=msg.file_name or "file")
