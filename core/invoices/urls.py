from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import InvoiceEntryViewSet, InvoicePlanViewSet

router = DefaultRouter()
router.register("invoice_plans", InvoicePlanViewSet, basename="invoiceplan")
router.register("invoice_entries", InvoiceEntryViewSet, basename="invoiceentry")

urlpatterns = [path("", include(router.urls))]
