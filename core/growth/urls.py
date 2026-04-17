from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import GrowthPlanViewSet

router = DefaultRouter()
router.register("growth_plans", GrowthPlanViewSet, basename="growthplan")

urlpatterns = [path("", include(router.urls))]
