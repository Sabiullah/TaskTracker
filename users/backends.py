from django.contrib.auth.backends import ModelBackend
from django.http import HttpRequest

from .models import User


class EmailOrUsernameBackend(ModelBackend):
    """
    Authenticate with either email or username.
    Django's authenticate() will call this via AUTHENTICATION_BACKENDS.
    """

    def authenticate(
        self,
        request: HttpRequest | None,
        username: str | None = None,
        password: str | None = None,
        **kwargs,
    ) -> User | None:
        if not username or not password:
            return None

        # Try email first, then username
        user = (
            User.objects.filter(email__iexact=username).first()
            or User.objects.filter(username__iexact=username).first()
        )

        if user and user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
