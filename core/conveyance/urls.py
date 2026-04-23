from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ConveyanceEntryViewSet

router = DefaultRouter()
router.register("conveyance_entries", ConveyanceEntryViewSet, basename="conveyanceentry")

urlpatterns = [path("", include(router.urls))]
