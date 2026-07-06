from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CostingEntryViewSet

router = DefaultRouter()
router.register("costing_entries", CostingEntryViewSet, basename="costingentry")

urlpatterns = [path("", include(router.urls))]
