"""Switch owners from flat plan/entry level to per-category.

Drops ``InvoicePlanOwner`` and ``InvoiceEntryOwner``; adds
``InvoicePlanCategoryOwner`` and ``InvoiceEntryCategoryOwner`` so each
category contribution carries its own owner allocation. Existing flat
owners are copied onto every category link of their plan/entry, which
preserves the *amount* each owner sees today (since the old report
multiplied ``cat% × owner%`` independently).
"""

import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def copy_flat_owners_to_categories(apps, schema_editor):
    InvoicePlanOwner = apps.get_model("invoices", "InvoicePlanOwner")
    InvoicePlanCategory = apps.get_model("invoices", "InvoicePlanCategory")
    InvoicePlanCategoryOwner = apps.get_model("invoices", "InvoicePlanCategoryOwner")
    InvoiceEntryOwner = apps.get_model("invoices", "InvoiceEntryOwner")
    InvoiceEntryCategory = apps.get_model("invoices", "InvoiceEntryCategory")
    InvoiceEntryCategoryOwner = apps.get_model("invoices", "InvoiceEntryCategoryOwner")

    plan_owners_by_plan: dict[int, list] = {}
    for po in InvoicePlanOwner.objects.all():
        plan_owners_by_plan.setdefault(po.plan_id, []).append(po)
    for plan_cat in InvoicePlanCategory.objects.all():
        for po in plan_owners_by_plan.get(plan_cat.plan_id, []):
            InvoicePlanCategoryOwner.objects.create(
                plan_category=plan_cat,
                user_id=po.user_id,
                contribution_pct=po.contribution_pct,
            )

    entry_owners_by_entry: dict[int, list] = {}
    for eo in InvoiceEntryOwner.objects.all():
        entry_owners_by_entry.setdefault(eo.entry_id, []).append(eo)
    for entry_cat in InvoiceEntryCategory.objects.all():
        for eo in entry_owners_by_entry.get(entry_cat.entry_id, []):
            InvoiceEntryCategoryOwner.objects.create(
                entry_category=entry_cat,
                user_id=eo.user_id,
                contribution_pct=eo.contribution_pct,
            )


def reverse_copy(apps, schema_editor):
    """Best-effort reverse: collapse per-category owners back into flat
    plan/entry owners by averaging the per-category contributions
    weighted by category contribution. Reverse is mostly a safety net for
    development — the new model carries strictly more information than
    the old one, so a true round-trip is impossible.
    """
    from collections import defaultdict
    from decimal import Decimal

    InvoicePlanOwner = apps.get_model("invoices", "InvoicePlanOwner")
    InvoicePlanCategoryOwner = apps.get_model("invoices", "InvoicePlanCategoryOwner")
    InvoiceEntryOwner = apps.get_model("invoices", "InvoiceEntryOwner")
    InvoiceEntryCategoryOwner = apps.get_model("invoices", "InvoiceEntryCategoryOwner")

    plan_totals: dict[tuple[int, int], Decimal] = defaultdict(lambda: Decimal("0"))
    for pco in InvoicePlanCategoryOwner.objects.select_related("plan_category"):
        cat_share = pco.plan_category.contribution_pct / Decimal("100")
        plan_totals[(pco.plan_category.plan_id, pco.user_id)] += pco.contribution_pct * cat_share
    for (plan_id, user_id), pct in plan_totals.items():
        InvoicePlanOwner.objects.create(plan_id=plan_id, user_id=user_id, contribution_pct=pct)

    entry_totals: dict[tuple[int, int], Decimal] = defaultdict(lambda: Decimal("0"))
    for eco in InvoiceEntryCategoryOwner.objects.select_related("entry_category"):
        cat_share = eco.entry_category.contribution_pct / Decimal("100")
        entry_totals[(eco.entry_category.entry_id, eco.user_id)] += eco.contribution_pct * cat_share
    for (entry_id, user_id), pct in entry_totals.items():
        InvoiceEntryOwner.objects.create(entry_id=entry_id, user_id=user_id, contribution_pct=pct)


class Migration(migrations.Migration):
    dependencies = [
        ("invoices", "0006_attribution_through_tables"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="InvoicePlanCategoryOwner",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "contribution_pct",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=5,
                        validators=[
                            django.core.validators.MinValueValidator(0),
                            django.core.validators.MaxValueValidator(100),
                        ],
                    ),
                ),
                (
                    "plan_category",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="owner_links",
                        to="invoices.invoiceplancategory",
                    ),
                ),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "unique_together": {("plan_category", "user")},
            },
        ),
        migrations.CreateModel(
            name="InvoiceEntryCategoryOwner",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "contribution_pct",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=5,
                        validators=[
                            django.core.validators.MinValueValidator(0),
                            django.core.validators.MaxValueValidator(100),
                        ],
                    ),
                ),
                (
                    "entry_category",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="owner_links",
                        to="invoices.invoiceentrycategory",
                    ),
                ),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "unique_together": {("entry_category", "user")},
            },
        ),
        migrations.RunPython(copy_flat_owners_to_categories, reverse_copy),
        migrations.RemoveField(model_name="invoiceplan", name="default_owners"),
        migrations.DeleteModel(name="InvoicePlanOwner"),
        migrations.RemoveField(model_name="invoiceentry", name="owners"),
        migrations.DeleteModel(name="InvoiceEntryOwner"),
    ]
