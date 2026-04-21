from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ClientActionPointViewSet,
    ClientMeetingAttachmentViewSet,
    ClientMeetingViewSet,
    ClientRoadmapViewSet,
    MasterViewSet,
)

router = DefaultRouter()
router.register("masters", MasterViewSet, basename="master")
router.register("client-roadmap", ClientRoadmapViewSet, basename="client-roadmap")
router.register("client-meetings", ClientMeetingViewSet, basename="client-meeting")
router.register("client-action-points", ClientActionPointViewSet, basename="client-action-point")
router.register("client-attachments", ClientMeetingAttachmentViewSet, basename="client-attachment")

urlpatterns = [path("", include(router.urls))]
