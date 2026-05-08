from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ClientActionPointAttachmentViewSet,
    ClientActionPointViewSet,
    ClientMeetingAttachmentViewSet,
    ClientMeetingViewSet,
    ClientMonthlyReportViewSet,
    ClientRoadmapViewSet,
    ClientVisitViewSet,
    MasterViewSet,
    MonthlyReportAttachmentViewSet,
    MonthlyReportRequirementViewSet,
    VisitReportAttachmentViewSet,
    VisitReportAuditEventViewSet,
    VisitReportViewSet,
)

router = DefaultRouter()
router.register("masters", MasterViewSet, basename="master")
router.register("client-roadmap", ClientRoadmapViewSet, basename="client-roadmap")
router.register("client-meetings", ClientMeetingViewSet, basename="client-meeting")
router.register("client-action-points", ClientActionPointViewSet, basename="client-action-point")
router.register("client-attachments", ClientMeetingAttachmentViewSet, basename="client-attachment")
router.register(
    "client-ap-attachments",
    ClientActionPointAttachmentViewSet,
    basename="client-ap-attachment",
)
router.register("client-visits", ClientVisitViewSet, basename="client-visit")
router.register("visit-reports", VisitReportViewSet, basename="visit-report")
router.register(
    "visit-audit-events",
    VisitReportAuditEventViewSet,
    basename="visit-audit-event",
)
router.register(
    "visit-report-attachments",
    VisitReportAttachmentViewSet,
    basename="visit-report-attachment",
)
router.register(
    "client-monthly-reports",
    ClientMonthlyReportViewSet,
    basename="client-monthly-report",
)
router.register(
    "monthly-report-attachments",
    MonthlyReportAttachmentViewSet,
    basename="monthly-report-attachment",
)
router.register(
    "monthly-report-requirements",
    MonthlyReportRequirementViewSet,
    basename="monthly-report-requirement",
)

urlpatterns = [path("", include(router.urls))]
