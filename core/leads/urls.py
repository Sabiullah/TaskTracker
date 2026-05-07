from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    LeadAttachmentViewSet,
    LeadHistoryViewSet,
    LeadStatusViewSet,
    LeadViewSet,
)

router = DefaultRouter()
router.register("lead_statuses", LeadStatusViewSet, basename="leadstatus")
router.register("leads", LeadViewSet, basename="lead")
router.register("lead_history", LeadHistoryViewSet, basename="leadhistory")
router.register("lead-attachments", LeadAttachmentViewSet, basename="lead-attachment")

urlpatterns = [path("", include(router.urls))]
