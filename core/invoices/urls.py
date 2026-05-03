from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    InvoiceCategoryViewSet,
    InvoiceEntryViewSet,
    InvoicePlanViewSet,
    InvoiceReportView,
)

router = DefaultRouter()
router.register("invoice_plans", InvoicePlanViewSet, basename="invoiceplan")
router.register("invoice_entries", InvoiceEntryViewSet, basename="invoiceentry")
router.register("invoice_categories", InvoiceCategoryViewSet, basename="invoicecategory")

urlpatterns = [
    path("", include(router.urls)),
    path("invoice_reports/", InvoiceReportView.as_view(), name="invoice-reports"),
]
