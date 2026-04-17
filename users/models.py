import uuid

from django.contrib.auth.models import (
    AbstractBaseUser,
    BaseUserManager,
    PermissionsMixin,
)
from django.core.validators import RegexValidator
from django.db import models

HEX_COLOR_VALIDATOR = RegexValidator(
    regex=r"^#[0-9a-fA-F]{6}$",
    message="Color must be a 6-digit hex code, e.g. '#1e293b'.",
)


class Org(models.Model):
    """Top-level tenant / organisation that owns all other records."""

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    name = models.CharField(max_length=255, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "orgs"
        ordering = ["name"]
        verbose_name = "organisation"
        verbose_name_plural = "organisations"

    def __str__(self) -> str:
        return self.name


class UserManager(BaseUserManager["User"]):
    def create_user(self, password: str | None = None, **extra_fields) -> "User":
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
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
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
    # Declarations for the descriptors Django adds implicitly — gives
    # static type-checkers (pyright/pylance) enough to resolve these
    # without running the django-stubs mypy plugin.
    id: int
    subordinates: "models.Manager[User]"  # reverse of the self-M2M `managers`

    ROLE_CHOICES = [
        ("admin", "Admin"),
        ("manager", "Manager"),
        ("employee", "Employee"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    email = models.EmailField(unique=True)
    # username is always derived/set — never left null
    username = models.CharField(max_length=150, unique=True, blank=True, default="")
    full_name = models.CharField(max_length=150, blank=True, db_index=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="employee")
    avatar_color = models.CharField(
        max_length=7,
        blank=True,
        default="",
        validators=[HEX_COLOR_VALIDATOR],
        help_text="Hex color used for the user's avatar circle, e.g. '#1e293b'.",
    )
    org = models.ForeignKey(
        Org,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="members",
    )

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    managers = models.ManyToManyField(
        "self",
        symmetrical=False,
        blank=True,
        related_name="subordinates",
        related_query_name="subordinate",
    )

    invoice_access = models.BooleanField(default=False)
    notice_access = models.BooleanField(default=False)
    masters_access = models.BooleanField(default=False)
    attendance_access = models.BooleanField(default=False)
    employee_access = models.BooleanField(default=False)

    # Access audit trail — who granted each permission and when
    invoice_access_granted_by = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    invoice_access_granted_at = models.DateTimeField(null=True, blank=True)
    notice_access_granted_by = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    notice_access_granted_at = models.DateTimeField(null=True, blank=True)
    masters_access_granted_by = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    masters_access_granted_at = models.DateTimeField(null=True, blank=True)
    attendance_access_granted_by = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    attendance_access_granted_at = models.DateTimeField(null=True, blank=True)
    employee_access_granted_by = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    employee_access_granted_at = models.DateTimeField(null=True, blank=True)

    objects: UserManager = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        verbose_name = "user"
        verbose_name_plural = "users"

    def __str__(self) -> str:
        return self.full_name or self.username or self.email
