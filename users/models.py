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


ROLE_CHOICES = [
    ("admin", "Admin"),
    ("manager", "Manager"),
    ("employee", "Employee"),
]

# Per-org feature toggles that used to live as booleans on User. The ordered
# tuple keeps serialiser output deterministic and drives the helper factory
# below — add a new feature in one place and all the helpers update.
ACCESS_FEATURES = (
    "invoice_access",
    "notice_access",
    "masters_access",
    "attendance_access",
    "employee_access",
    "leads_access",
    "conveyance_access",
)


class Org(models.Model):
    """Top-level organisation. Internal — not used for tenant isolation.

    A User can be a member of multiple Orgs via `OrgMembership`; the viewsets
    show merged data across every org the user belongs to. Row-level ownership
    still lives on each model's `org` FK so the UI can label which org a row
    came from.
    """

    # Static-typing hint for pyright — Django's implicit `id` is a Big/AutoField
    # at runtime but stubs don't always surface it to static analysers.
    id: int

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
        """Create a Django superuser without any Org or OrgMembership.

        Superusers can always reach the Django admin (``is_staff=True``,
        ``is_superuser=True``) — so grant themselves org membership and a
        role there once orgs exist. This keeps ``manage.py createsuperuser``
        free of ambient side-effects like an auto-generated "Default" org.

        If you need to bootstrap both a user AND their first org in one go,
        use ``seed_initial_data`` — that command creates the org explicitly
        and attaches the admin membership with all access flags granted.
        """
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        # Ignore any `org` kwarg deliberately — see docstring above.
        extra_fields.pop("org", None)
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
    # Typing helpers so pyright/pylance resolve the managers without the
    # django-stubs mypy plugin.
    id: int
    subordinates: "models.Manager[User]"
    memberships: "models.Manager[OrgMembership]"

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    email = models.EmailField(unique=True)
    username = models.CharField(max_length=150, unique=True, blank=True, default="")
    full_name = models.CharField(max_length=150, blank=True, db_index=True)
    avatar_color = models.CharField(
        max_length=7,
        blank=True,
        default="",
        validators=[HEX_COLOR_VALIDATOR],
        help_text="Hex color used for the user's avatar circle, e.g. '#1e293b'.",
    )

    # Multi-org membership. Role AND feature-access live on OrgMembership so a
    # user can be (admin, all-access) in 4D while (employee, read-only) in YBV.
    # `through_fields` is required because OrgMembership has multiple FKs back
    # to User (the five ``*_access_granted_by`` audit columns) — Django
    # otherwise can't tell which FK terminates the M2M. The explicit generic
    # args silence mypy's ``var-annotated`` check for M2M+through fields.
    orgs: models.ManyToManyField[Org, "OrgMembership"] = models.ManyToManyField(
        Org,
        through="OrgMembership",
        through_fields=("user", "org"),
        related_name="members",
        blank=True,
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

    objects: UserManager = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        verbose_name = "user"
        verbose_name_plural = "users"

    def __str__(self) -> str:
        # UI labels should always prefer the display name; fall back to email
        # (the login identifier) before username so we never leak a
        # lowercase slug into user-facing surfaces like TaskLog snapshots.
        return self.full_name or self.email or self.username

    # ── Multi-org helpers ───────────────────────────────────────────────────
    def org_ids(self):
        """QuerySet of org IDs this user belongs to.

        Chains directly into `filter(org_id__in=...)` without materialising
        a list.
        """
        return self.memberships.values_list("org_id", flat=True)

    def role_in(self, org) -> str | None:
        """Role this user holds in `org`, or None if not a member."""
        if org is None:
            return None
        org_pk = org.pk if hasattr(org, "pk") else org
        m = self.memberships.filter(org_id=org_pk).first()
        return m.role if m else None

    def is_admin_in(self, org) -> bool:
        return self.role_in(org) == "admin"

    def is_manager_in(self, org) -> bool:
        """True if admin or manager in this org. Admins always count as managers."""
        return self.role_in(org) in ("admin", "manager")

    def is_manager_in_id(self, org_id) -> bool:
        """Same as is_manager_in but takes a raw org_id (avoids an Org lookup)."""
        return self.memberships.filter(
            org_id=org_id, role__in=["admin", "manager"]
        ).exists()

    def is_admin_in_any(self) -> bool:
        return self.memberships.filter(role="admin").exists()

    def is_manager_in_any(self) -> bool:
        return self.memberships.filter(role__in=["admin", "manager"]).exists()

    @property
    def default_org(self) -> "Org | None":
        """Primary org: the membership flagged default, else the first one.

        Used as the auto-assigned org on create when the payload omits org_id
        and the user belongs to exactly one org.
        """
        m = self.memberships.order_by("-is_default", "id").select_related("org").first()
        return m.org if m else None

    @property
    def highest_role(self) -> str:
        """Best role across every org: admin > manager > employee.

        For list-level UI guards where a specific org isn't in scope yet.
        """
        roles = set(self.memberships.values_list("role", flat=True))
        if "admin" in roles:
            return "admin"
        if "manager" in roles:
            return "manager"
        return "employee"

    # ── Per-org access-flag helpers ─────────────────────────────────────────
    # Kept explicit (rather than generated via setattr) so static type
    # checkers can see them. Each method uses the same ``_has_access_in`` /
    # ``_has_access_in_any`` private helper so there's still one place to fix
    # the logic.

    def _has_access_in(self, feature: str, org) -> bool:
        if org is None:
            return False
        org_pk = org.pk if hasattr(org, "pk") else org
        return self.memberships.filter(org_id=org_pk, **{feature: True}).exists()

    def _has_access_in_any(self, feature: str) -> bool:
        return self.memberships.filter(**{feature: True}).exists()

    # Invoice access
    def has_invoice_in(self, org) -> bool:
        return self._has_access_in("invoice_access", org)

    def has_invoice_in_any(self) -> bool:
        return self._has_access_in_any("invoice_access")

    # Notice access
    def has_notice_in(self, org) -> bool:
        return self._has_access_in("notice_access", org)

    def has_notice_in_any(self) -> bool:
        return self._has_access_in_any("notice_access")

    # Masters access
    def has_masters_in(self, org) -> bool:
        return self._has_access_in("masters_access", org)

    def has_masters_in_any(self) -> bool:
        return self._has_access_in_any("masters_access")

    # Attendance access
    def has_attendance_in(self, org) -> bool:
        return self._has_access_in("attendance_access", org)

    def has_attendance_in_any(self) -> bool:
        return self._has_access_in_any("attendance_access")

    # Employee access
    def has_employee_in(self, org) -> bool:
        return self._has_access_in("employee_access", org)

    def has_employee_in_any(self) -> bool:
        return self._has_access_in_any("employee_access")

    # Leads access
    def has_leads_in(self, org) -> bool:
        return self._has_access_in("leads_access", org)

    def has_leads_in_any(self) -> bool:
        return self._has_access_in_any("leads_access")

    # Conveyance access
    def has_conveyance_in(self, org) -> bool:
        return self._has_access_in("conveyance_access", org)

    def has_conveyance_in_any(self) -> bool:
        return self._has_access_in_any("conveyance_access")


class OrgMembership(models.Model):
    """User ↔ Org membership: per-org role AND per-org feature access.

    One row per (user, org). Both `role` and every `*_access` flag are scoped
    to this single org, so a user can be admin-with-all-access in 4D and an
    employee with only `masters_access` in YBV.
    """

    # Static-typing hints so pyright sees these implicit Django attributes.
    id: int
    user_id: int
    org_id: int

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    org = models.ForeignKey(
        Org,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="employee")
    is_default = models.BooleanField(
        default=False,
        help_text="Marks the user's primary org. At most one membership per user carries this.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ── Feature access (per-org) ────────────────────────────────────────────
    invoice_access = models.BooleanField(default=False)
    notice_access = models.BooleanField(default=False)
    masters_access = models.BooleanField(default=False)
    attendance_access = models.BooleanField(default=False)
    employee_access = models.BooleanField(default=False)
    leads_access = models.BooleanField(default=False)
    conveyance_access = models.BooleanField(default=False)

    # Per-org opt-out of the daily Operational standup roster (admin/senior staff).
    exclude_from_operational_standup = models.BooleanField(default=False)

    # Audit trail for access grants (who toggled each flag on, and when).
    invoice_access_granted_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    invoice_access_granted_at = models.DateTimeField(null=True, blank=True)
    notice_access_granted_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    notice_access_granted_at = models.DateTimeField(null=True, blank=True)
    masters_access_granted_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    masters_access_granted_at = models.DateTimeField(null=True, blank=True)
    attendance_access_granted_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    attendance_access_granted_at = models.DateTimeField(null=True, blank=True)
    employee_access_granted_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    employee_access_granted_at = models.DateTimeField(null=True, blank=True)
    leads_access_granted_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    leads_access_granted_at = models.DateTimeField(null=True, blank=True)
    conveyance_access_granted_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    conveyance_access_granted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "users_orgmembership"
        unique_together = [("user", "org")]
        ordering = ["-is_default", "org__name"]
        verbose_name = "org membership"
        verbose_name_plural = "org memberships"

    def __str__(self) -> str:
        return f"{self.user} / {self.org} ({self.role})"
