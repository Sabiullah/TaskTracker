from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AppSettingViewSet

router = DefaultRouter()
router.register("app_settings", AppSettingViewSet, basename="appsetting")

urlpatterns = [path("", include(router.urls))]
