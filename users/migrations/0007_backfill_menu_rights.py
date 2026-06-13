from django.db import migrations

from users.migrations._menu_backfill import seed_membership_rights


def forwards(apps, schema_editor):
    MenuRight = apps.get_model("users", "MenuRight")
    OrgMembership = apps.get_model("users", "OrgMembership")
    for m in OrgMembership.objects.all().iterator():
        seed_membership_rights(MenuRight, m)


def backwards(apps, schema_editor):
    apps.get_model("users", "MenuRight").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("users", "0006_menuright")]
    operations = [migrations.RunPython(forwards, backwards)]
