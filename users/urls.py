from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

router = DefaultRouter()
router.register("orgs", views.OrgViewSet, basename="org")

urlpatterns = [
    # Auth
    path("auth/login/", views.login),
    path("auth/logout/", views.logout),
    path("auth/refresh/", TokenRefreshView.as_view()),
    path("auth/me/", views.me),
    # User management
    path("profiles/", views.profiles),
    path("users/create/", views.create_user),
    path("users/reset-password/", views.reset_password),
    path("users/delete/", views.delete_user),
    path("users/<str:user_uid>/", views.update_user),
    # Access control
    path("invoice_access/", views.invoice_access_list),
    path("notice_access/", views.notice_access_list),
    path("masters_access/", views.masters_access_list),
    path("attendance_access/", views.attendance_access_list),
    path("employee_access/", views.employee_access_list),
    # Orgs (ModelViewSet routes)
    path("", include(router.urls)),
]
