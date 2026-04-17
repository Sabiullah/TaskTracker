from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import WorkLogViewSet, WorkPlanViewSet

router = DefaultRouter()
router.register("work_logs", WorkLogViewSet, basename="worklog")
router.register("work_plans", WorkPlanViewSet, basename="workplan")

urlpatterns = [path("", include(router.urls))]
