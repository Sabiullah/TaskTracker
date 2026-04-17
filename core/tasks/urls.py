from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import TaskLogViewSet, TaskViewSet

router = DefaultRouter()
router.register("tasks", TaskViewSet, basename="task")
router.register("task_logs", TaskLogViewSet, basename="tasklog")

urlpatterns = [path("", include(router.urls))]
