from django.urls import path

from .views import BackupView, RestoreView

urlpatterns = [
    path("backup/", BackupView.as_view(), name="backup"),
    path("backup/restore/", RestoreView.as_view(), name="backup-restore"),
]
