"""Data transformation for the OrgMembership migration.

When `makemigrations users` generates the schema migration that creates
`OrgMembership` and drops the legacy columns (`User.org`, `User.role`, and the
five `*_access` / `*_access_granted_by` / `*_access_granted_at` fields), the
data on those old columns must be copied into `OrgMembership` rows BEFORE the
columns are removed. Otherwise we lose everything.

This module captures the forward/reverse functions in one place so the
generated migration only needs to wire them in via `migrations.RunPython`. See
the README at the bottom of this file for the exact operation order.
"""

from __future__ import annotations

# Mirrors ACCESS_FEATURES in users/models.py. Duplicated here because
# migrations must be self-contained — they can't import from the live model
# module (which is ahead of the migration's frozen state).
_ACCESS_FEATURES = (
    "invoice_access",
    "notice_access",
    "masters_access",
    "attendance_access",
    "employee_access",
    "leads_access",
)


def forward(apps, schema_editor) -> None:
    """For every user with a legacy `org` + `role`, create an OrgMembership.

    Copies across the five `*_access` booleans and their `*_granted_by` /
    `*_granted_at` audit fields so nothing is lost when the columns get
    dropped in the subsequent schema operations. Idempotent — re-running
    produces no duplicates because of `get_or_create`.
    """
    User = apps.get_model("users", "User")
    OrgMembership = apps.get_model("users", "OrgMembership")

    for user in User.objects.select_related("org").all():
        org = getattr(user, "org", None)
        if org is None:
            continue

        defaults: dict = {
            "role": getattr(user, "role", None) or "employee",
            "is_default": True,
        }
        for feat in _ACCESS_FEATURES:
            defaults[feat] = bool(getattr(user, feat, False))
            granted_by_id = getattr(user, f"{feat}_granted_by_id", None)
            granted_at = getattr(user, f"{feat}_granted_at", None)
            if granted_by_id is not None:
                defaults[f"{feat}_granted_by_id"] = granted_by_id
            if granted_at is not None:
                defaults[f"{feat}_granted_at"] = granted_at

        OrgMembership.objects.get_or_create(
            user=user,
            org=org,
            defaults=defaults,
        )


def reverse(apps, schema_editor) -> None:
    """Pushing data back to User is only meaningful if the old columns still
    exist in the schema. If someone runs `migrate users <previous>` after the
    columns have been dropped, the reverse is a no-op.

    For each user, find their `is_default=True` membership (fallback: first)
    and copy the role + access fields back.
    """
    User = apps.get_model("users", "User")
    OrgMembership = apps.get_model("users", "OrgMembership")

    # If the legacy columns aren't on the frozen model state, skip.
    user_fields = {f.name for f in User._meta.get_fields()}
    if "org" not in user_fields or "role" not in user_fields:
        return

    for user in User.objects.all():
        m = OrgMembership.objects.filter(user=user).order_by("-is_default", "id").first()
        if m is None:
            continue
        user.org_id = m.org_id
        user.role = m.role
        for feat in _ACCESS_FEATURES:
            setattr(user, feat, getattr(m, feat, False))
            gb = getattr(m, f"{feat}_granted_by_id", None)
            ga = getattr(m, f"{feat}_granted_at", None)
            if f"{feat}_granted_by" in user_fields:
                setattr(user, f"{feat}_granted_by_id", gb)
            if f"{feat}_granted_at" in user_fields:
                setattr(user, f"{feat}_granted_at", ga)
        user.save()


# ─── How to wire this into the generated migration ─────────────────────────
#
# After `uv run python manage.py makemigrations users` produces the next
# migration file (expected name: `000N_orgmembership_per_org_access.py`),
# edit its `operations` list so they run in this order:
#
#   1. migrations.CreateModel("OrgMembership", ...)            (auto)
#   2. migrations.AddField("User", "orgs", ...M2M through...)  (auto)
#   3. migrations.RunPython(forward, reverse)                  (add manually)
#   4. migrations.RemoveField("User", "org")                   (auto)
#   5. migrations.RemoveField("User", "role")                  (auto)
#   6. migrations.RemoveField("User", "invoice_access")        (auto)
#   ...remove each of the five access flags + 10 audit fields
#
# Then add at the top of the generated file:
#   from users.migrations._data_transform import forward, reverse
#
# Verify with `uv run python manage.py sqlmigrate users 000N` before applying.
