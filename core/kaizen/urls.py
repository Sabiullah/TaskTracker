from django.urls import include, path
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
# ViewSets registered in Task 5.

urlpatterns = [path("", include(router.urls))]
