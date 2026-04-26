from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import WorkingDayOverrideViewSet

router = DefaultRouter()
router.register("working-day-overrides", WorkingDayOverrideViewSet, basename="working-day-override")

urlpatterns = [path("", include(router.urls))]
