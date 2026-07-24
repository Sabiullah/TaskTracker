from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ApkVersionView, AppSettingViewSet

router = DefaultRouter()
router.register("app_settings", AppSettingViewSet, basename="appsetting")

urlpatterns = [
    path("apk_version/", ApkVersionView.as_view(), name="apk-version"),
    path("", include(router.urls)),
]
