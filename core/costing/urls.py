from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CostingEntryViewSet, EmployeeSeatCostViewSet, SeatCostSettingViewSet

router = DefaultRouter()
router.register("costing_entries", CostingEntryViewSet, basename="costingentry")
router.register("seat_cost_settings", SeatCostSettingViewSet, basename="seatcostsetting")
router.register("employee_seat_costs", EmployeeSeatCostViewSet, basename="employeeseatcost")

urlpatterns = [path("", include(router.urls))]
