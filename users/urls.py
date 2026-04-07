from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

urlpatterns = [
    path("auth/login/", views.login),
    path("auth/logout/", views.logout),
    path("auth/refresh/", TokenRefreshView.as_view()),
    path("auth/me/", views.me),
    path("profiles/", views.profiles),
    path("users/create/", views.create_user),
    path("users/reset-password/", views.reset_password),
    path("users/delete/", views.delete_user),
    path("users/<int:user_id>/", views.update_user),
    # Access control compatibility endpoints
    path("invoice_access/", views.invoice_access_list),
    path("notice_access/", views.notice_access_list),
]
