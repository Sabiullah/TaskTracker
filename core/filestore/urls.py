from django.urls import path

from .views import ServeFileView

urlpatterns = [
    path("serve/", ServeFileView.as_view(), name="filestore-serve"),
]
