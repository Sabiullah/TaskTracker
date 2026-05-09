# Add a self-FK on Master so categories can declare a parent.
#
# A "main category" is a category-type Master with ``parent=None``; its
# children are the auto-populated subtask categories surfaced in the
# Add/Edit Task modal. Nullable + SET_NULL so an admin can delete a
# parent without losing the children — they just become top-level rows.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("masters", "0013_monthly_requirement_persistent"),
    ]

    operations = [
        migrations.AddField(
            model_name="master",
            name="parent",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name="children",
                to="masters.master",
            ),
        ),
    ]
