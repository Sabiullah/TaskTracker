from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ConveyanceAttachmentViewSet, ConveyanceEntryViewSet

router = DefaultRouter()
router.register("conveyance_entries", ConveyanceEntryViewSet, basename="conveyanceentry")
router.register("conveyance_attachments", ConveyanceAttachmentViewSet, basename="conveyanceattachment")

urlpatterns = [path("", include(router.urls))]
