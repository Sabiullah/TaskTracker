"""Shared DRF permission classes.

Role values live on ``users.User.role``: ``admin`` | ``manager`` | ``user``.
Use these classes in viewsets instead of redefining per-app copies.
"""

from rest_framework import permissions


def _role(request):
    return getattr(request.user, "role", None) if request.user.is_authenticated else None


class IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return _role(request) == "admin"


class IsAdminOrManager(permissions.BasePermission):
    def has_permission(self, request, view):
        return _role(request) in ("admin", "manager")


class IsAdminOrReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return request.user.is_authenticated
        return _role(request) == "admin"
