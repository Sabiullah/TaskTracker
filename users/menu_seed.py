"""Runtime seeding of a new membership's baseline menu rights.

The historical backfill (migration 0007) seeds memberships that existed when
the feature shipped. This module covers memberships created *afterwards* (via
``create_user`` / add-to-org), so a brand-new non-admin is never left with an
empty nav. The User Rights matrix is the source of truth from then on — this
only sets sensible defaults at creation time.
"""

from django.utils import timezone

from .menu_catalog import ALWAYS_ON_VIEW, FEATURE_TO_CODE, children_of, top_level_code


def _grant(membership, code, *, view, edit, granted_by=None):
    """Upsert one MenuRight, OR-ing levels onto any existing row."""
    from .models import MenuRight

    edit = bool(edit)
    view = bool(view) or edit
    row, created = MenuRight.objects.get_or_create(
        membership=membership,
        menu_code=code,
        defaults={"can_view": view, "can_edit": edit, "granted_by": granted_by, "granted_at": timezone.now()},
    )
    if not created and ((view and not row.can_view) or (edit and not row.can_edit)):
        row.can_view = row.can_view or view
        row.can_edit = row.can_edit or edit
        row.save()


def seed_membership_baseline(membership, granted_by=None) -> None:
    """Seed always-on view + map any enabled legacy access flags to view+edit.

    No-op for admins (they bypass the rights table entirely)."""
    if membership.role == "admin":
        return

    for code in ALWAYS_ON_VIEW:
        _grant(membership, code, view=True, edit=False, granted_by=granted_by)
        for sub in children_of(code):
            _grant(membership, sub.code, view=True, edit=False, granted_by=granted_by)

    for feature, code in FEATURE_TO_CODE.items():
        if not getattr(membership, feature, False):
            continue
        parent = top_level_code(code)
        _grant(membership, parent, view=True, edit=True, granted_by=granted_by)
        _grant(membership, code, view=True, edit=True, granted_by=granted_by)
        for sub in children_of(parent):
            _grant(membership, sub.code, view=True, edit=True, granted_by=granted_by)
