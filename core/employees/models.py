import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models

from core.base import TimeStampedModel
from core.filestore.validators import employee_address_proof_upload_to

# India-specific identity formats. Applied only when the field is set
# (blank is always allowed — these fields are optional).
AADHAR_VALIDATOR = RegexValidator(
    regex=r"^\d{12}$",
    message="Aadhaar must be exactly 12 digits.",
)
PAN_VALIDATOR = RegexValidator(
    regex=r"^[A-Z]{5}[0-9]{4}[A-Z]$",
    message="PAN must be in the format ABCDE1234F (5 letters, 4 digits, 1 letter).",
)
IFSC_VALIDATOR = RegexValidator(
    regex=r"^[A-Z]{4}0[A-Z0-9]{6}$",
    message="IFSC must be 4 letters, a 0, then 6 alphanumerics (e.g. HDFC0001234).",
)


class Employee(TimeStampedModel):
    STATUS_CHOICES = [
        ("Active", "Active"),
        ("Inactive", "Inactive"),
        ("Resigned", "Resigned"),
    ]
    GENDER_CHOICES = [
        ("Male", "Male"),
        ("Female", "Female"),
        ("Other", "Other"),
    ]
    MARITAL_CHOICES = [
        ("Single", "Single"),
        ("Married", "Married"),
        ("Divorced", "Divorced"),
        ("Widowed", "Widowed"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="employees",
    )
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="employee_profile",
    )
    employee_name = models.CharField(max_length=150, db_index=True)
    date_of_joining = models.DateField(null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES, default="Male")
    blood_group = models.CharField(max_length=5, blank=True, default="")
    marital_status = models.CharField(max_length=20, choices=MARITAL_CHOICES, default="Single")
    father_name = models.CharField(max_length=150, blank=True, default="")
    phone = models.CharField(max_length=20, blank=True, default="")
    alt_phone = models.CharField(max_length=20, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    permanent_address = models.TextField(blank=True)
    current_address = models.TextField(blank=True)
    aadhar_number = models.CharField(max_length=20, blank=True, default="", validators=[AADHAR_VALIDATOR])
    pan_number = models.CharField(max_length=20, blank=True, default="", validators=[PAN_VALIDATOR])
    bank_name = models.CharField(max_length=150, blank=True, default="")
    bank_account = models.CharField(max_length=30, blank=True, default="")
    ifsc_code = models.CharField(max_length=15, blank=True, default="", validators=[IFSC_VALIDATOR])
    address_proof = models.FileField(upload_to=employee_address_proof_upload_to, null=True, blank=True)
    emergency_contact_name = models.CharField(max_length=150, blank=True, default="")
    emergency_contact_phone = models.CharField(max_length=20, blank=True, default="")
    emergency_contact_relation = models.CharField(max_length=50, blank=True, default="")
    reference_name = models.CharField(max_length=150, blank=True, default="")
    reference_contact = models.CharField(max_length=20, blank=True, default="")
    reference_relation = models.CharField(max_length=50, blank=True, default="")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Active", db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="employees",
    )

    class Meta:
        ordering = ["employee_name"]
        verbose_name = "employee"
        verbose_name_plural = "employees"

    def __str__(self):
        return self.employee_name


class EmployeeSalary(TimeStampedModel):
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="salary_records")
    designation = models.CharField(max_length=150, blank=True, default="")
    department = models.CharField(max_length=150, blank=True, default="")
    fixed_salary = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    basic_salary = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    hra = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    da = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    other_allowances = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    pf_number = models.CharField(max_length=30, blank=True, default="")
    esi_number = models.CharField(max_length=30, blank=True, default="")
    uan_number = models.CharField(max_length=30, blank=True, default="")
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    remarks = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_salary_records",
    )

    class Meta:
        ordering = ["-effective_from"]
        verbose_name = "employee salary"
        verbose_name_plural = "employee salaries"
        constraints = [
            models.UniqueConstraint(
                fields=["employee", "effective_from"],
                name="salary_unique_employee_effective_from",
            )
        ]

    def clean(self):
        if self.effective_to and self.effective_from and self.effective_from > self.effective_to:
            raise ValidationError("effective_from must be before effective_to.")

    def __str__(self):
        return f"{self.employee} - from {self.effective_from}"
