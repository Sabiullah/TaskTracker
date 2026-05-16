from django.urls import path

from core.gcal import views

urlpatterns = [
    path("gcal/auth-url/", views.auth_url, name="gcal-auth-url"),
    path(
        "gcal/oauth-callback/",
        views.oauth_callback,
        name="gcal-oauth-callback",
    ),
    path("gcal/status/", views.status_view, name="gcal-status"),
    path("gcal/credential/", views.disconnect, name="gcal-disconnect"),
]
