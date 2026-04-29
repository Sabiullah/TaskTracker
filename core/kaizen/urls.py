from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import KaizenViewSet

router = DefaultRouter()
router.register("kaizens", KaizenViewSet, basename="kaizen")

urlpatterns = [path("", include(router.urls))]
