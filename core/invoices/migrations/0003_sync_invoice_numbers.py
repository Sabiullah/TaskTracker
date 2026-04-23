from django.db import migrations


def sync_invoice_numbers(apps, schema_editor):
    """Within each (client, invoice_month) group, propagate the invoice
    number from the most-recently-updated entry to its siblings.

    Before this migration, re-uploading an invoice only rewrote the
    number on the targeted entry, so sibling entries (same client+month,
    different plan) could hold a stale number from an earlier upload.
    The list view joined every unique value and surfaced both numbers
    next to each other. One invoice per client+month is the product
    rule, so a one-shot reconciliation is safe.
    """
    InvoiceEntry = apps.get_model("invoices", "InvoiceEntry")
    groups: dict[tuple[int | None, object], list] = {}
    for e in InvoiceEntry.objects.select_related("plan"):
        client_id = e.plan.client_id if e.plan else None
        if client_id is None:
            continue
        groups.setdefault((client_id, e.invoice_month), []).append(e)
    for entries in groups.values():
        if len(entries) <= 1:
            continue
        with_num = [e for e in entries if e.invoice_number]
        if not with_num:
            continue
        latest = max(with_num, key=lambda e: e.updated_at or e.created_at)
        target = latest.invoice_number
        for e in entries:
            if e.invoice_number != target:
                e.invoice_number = target
                e.save(update_fields=["invoice_number"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("invoices", "0002_initial"),
    ]

    operations = [
        migrations.RunPython(sync_invoice_numbers, noop_reverse),
    ]
