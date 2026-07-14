from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CostingEntryViewSet, SeatCostSettingViewSet

router = DefaultRouter()
router.register("costing_entries", CostingEntryViewSet, basename="costingentry")
router.register("seat_cost_settings", SeatCostSettingViewSet, basename="seatcostsetting")

urlpatterns = [path("", include(router.urls))]
