from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ChatMemberViewSet,
    ChatMessageViewSet,
    ChatRoomViewSet,
    InvoiceEntryViewSet,
    InvoicePlanViewSet,
    LeadFollowupViewSet,
    LeadStatusViewSet,
    LeadViewSet,
    NoticeViewSet,
    TaskViewSet,
    WorkLogViewSet,
    WorkPlanViewSet,
)

router = DefaultRouter()
router.register("tasks", TaskViewSet, basename="task")
router.register("work_logs", WorkLogViewSet, basename="worklog")
router.register("work_plans", WorkPlanViewSet, basename="workplan")
router.register("notices", NoticeViewSet, basename="notice")
router.register("lead_statuses", LeadStatusViewSet, basename="leadstatus")
router.register("leads", LeadViewSet, basename="lead")
router.register("lead_followups", LeadFollowupViewSet, basename="leadfollowup")
router.register("invoice_plans", InvoicePlanViewSet, basename="invoiceplan")
router.register("invoice_entries", InvoiceEntryViewSet, basename="invoiceentry")
router.register("chat_rooms", ChatRoomViewSet, basename="chatroom")
router.register("chat_members", ChatMemberViewSet, basename="chatmember")
router.register("chat_messages", ChatMessageViewSet, basename="chatmessage")

urlpatterns = [path("", include(router.urls))]
