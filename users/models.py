from django.contrib.auth.models import (
    AbstractBaseUser,
    BaseUserManager,
    PermissionsMixin,
)
from django.db import models


class UserManager(BaseUserManager["User"]):
    def create_user(self, password: str = "123456", **extra_fields) -> "User":
        email = extra_fields.pop("email", "")
        username = extra_fields.pop("username", "")

        if not email and not username:
            raise ValueError("Either email or username must be provided")

        if email:
            email = self.normalize_email(email)
        if not username and email:
            username = self._derive_username(email.split("@")[0])
        if not email and username:
            email = f"{username}@tasktracker.local"

        user: User = self.model(email=email, username=username, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, password: str, **extra_fields) -> "User":
        extra_fields.setdefault("role", "admin")
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self.create_user(password=password, email=email, **extra_fields)

    def _derive_username(self, base: str) -> str:
        base = base.lower().replace(".", "_").replace("+", "_")
        username = base
        counter = 1
        while self.model.objects.filter(username=username).exists():
            username = f"{base}{counter}"
            counter += 1
        return username


class User(AbstractBaseUser, PermissionsMixin):
    ROLE_CHOICES = [
        ("admin", "Admin"),
        ("manager", "Manager"),
        ("employee", "Employee"),
    ]

    email = models.EmailField(unique=True)
    username = models.CharField(max_length=150, unique=True, blank=True)
    full_name = models.CharField(max_length=150, blank=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="employee")

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    managers = models.ManyToManyField(
        "self",
        symmetrical=False,
        blank=True,
        related_name="subordinates",
        related_query_name="subordinate",
    )
    subordinates: models.ManyToManyField  # reverse relation — declared for type checkers

    invoice_access = models.BooleanField(default=False)
    notice_access = models.BooleanField(default=False)

    objects: UserManager = UserManager()  # type: ignore[assignment]

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []  # no extra prompts for createsuperuser

    class Meta:
        verbose_name = "user"
        verbose_name_plural = "users"

    def __str__(self) -> str:
        return self.full_name or self.username or self.email
