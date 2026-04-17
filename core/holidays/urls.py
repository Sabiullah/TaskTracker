from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import HolidayViewSet

router = DefaultRouter()
router.register("holidays", HolidayViewSet, basename="holiday")

urlpatterns = [path("", include(router.urls))]
