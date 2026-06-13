from django.db.models.signals import post_save
from django.dispatch import receiver

from .menu_seed import seed_membership_baseline
from .models import OrgMembership


@receiver(post_save, sender=OrgMembership)
def seed_new_membership_rights(sender, instance, created, **kwargs):
    """Give a freshly-created non-admin membership its baseline menu rights so
    it never starts with an empty nav. Subsequent changes go through the User
    Rights matrix."""
    if created:
        seed_membership_baseline(instance)
