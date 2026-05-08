# Generated for client monthly report feature.

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("masters", "0011_visit_report_multi_attachment"),
        ("users", "0005_orgmembership_exclude_op_standup"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ClientMonthlyReport",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("uid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("year_month", models.CharField(db_index=True, max_length=7)),
                ("report_date", models.DateField(db_index=True)),
                ("report_name", models.CharField(max_length=255)),
                ("key_points", models.TextField(blank=True, default="")),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("Draft", "Draft"),
                            ("Pending", "Pending"),
                            ("Approved", "Approved"),
                            ("Reviewed", "Reviewed"),
                            ("Rejected", "Rejected"),
                        ],
                        db_index=True,
                        default="Draft",
                        max_length=20,
                    ),
                ),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("approved_at", models.DateTimeField(blank=True, null=True)),
                ("manager_comment", models.TextField(blank=True, default="")),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("review_comment", models.TextField(blank=True, default="")),
                (
                    "approved_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="approved_monthly_reports",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "assigned_manager",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="assigned_monthly_reports",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "client",
                    models.ForeignKey(
                        blank=True,
                        limit_choices_to={"type": "client"},
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="monthly_reports",
                        to="masters.master",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_monthly_reports",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "org",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="client_monthly_reports",
                        to="users.org",
                    ),
                ),
                (
                    "prepared_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="prepared_monthly_reports",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="reviewed_monthly_reports",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "client monthly report",
                "verbose_name_plural": "client monthly reports",
                "ordering": ["-year_month", "-report_date", "-created_at"],
            },
        ),
        migrations.CreateModel(
            name="MonthlyReportAttachment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("file", models.FileField(upload_to="monthly_reports/%Y/%m/")),
                ("filename", models.CharField(max_length=255)),
                ("size_bytes", models.PositiveBigIntegerField(default=0)),
                ("uploaded_at", models.DateTimeField(auto_now_add=True)),
                (
                    "report",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="attachments",
                        to="masters.clientmonthlyreport",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="uploaded_monthly_report_attachments",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "monthly report attachment",
                "verbose_name_plural": "monthly report attachments",
                "ordering": ["-uploaded_at"],
            },
        ),
        migrations.CreateModel(
            name="MonthlyReportAuditEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                (
                    "event_type",
                    models.CharField(
                        choices=[
                            ("created", "Created"),
                            ("submitted", "Submitted"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("reviewed", "Reviewed"),
                            ("resubmitted", "Resubmitted"),
                            ("required_changed", "Requirement changed"),
                        ],
                        max_length=30,
                    ),
                ),
                ("comment", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "actor",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="monthly_report_audit_actions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "report",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="audit_events",
                        to="masters.clientmonthlyreport",
                    ),
                ),
            ],
            options={
                "verbose_name": "monthly report audit event",
                "verbose_name_plural": "monthly report audit events",
                "ordering": ["report", "created_at"],
            },
        ),
        migrations.CreateModel(
            name="MonthlyReportRequirement",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("uid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("year_month", models.CharField(db_index=True, max_length=7)),
                ("required", models.BooleanField(default=False)),
                (
                    "client",
                    models.ForeignKey(
                        limit_choices_to={"type": "client"},
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="monthly_report_requirements",
                        to="masters.master",
                    ),
                ),
                (
                    "org",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="monthly_report_requirements",
                        to="users.org",
                    ),
                ),
                (
                    "set_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="set_monthly_report_requirements",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "monthly report requirement",
                "verbose_name_plural": "monthly report requirements",
                "ordering": ["-year_month", "client__name"],
            },
        ),
        migrations.AddIndex(
            model_name="clientmonthlyreport",
            index=models.Index(fields=["client", "year_month"], name="cmr_client_month_idx"),
        ),
        migrations.AddIndex(
            model_name="clientmonthlyreport",
            index=models.Index(fields=["org", "year_month", "status"], name="cmr_org_month_status_idx"),
        ),
        migrations.AddIndex(
            model_name="monthlyreportauditevent",
            index=models.Index(fields=["report", "created_at"], name="mrae_report_created_idx"),
        ),
        migrations.AddIndex(
            model_name="monthlyreportrequirement",
            index=models.Index(fields=["org", "year_month"], name="mrr_org_month_idx"),
        ),
        migrations.AlterUniqueTogether(
            name="monthlyreportrequirement",
            unique_together={("org", "client", "year_month")},
        ),
    ]
