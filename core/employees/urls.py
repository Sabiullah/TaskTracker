from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import EmployeeSalaryViewSet, EmployeeViewSet

router = DefaultRouter()
router.register("employees", EmployeeViewSet, basename="employee")
router.register("employee_salary", EmployeeSalaryViewSet, basename="employeesalary")

urlpatterns = [path("", include(router.urls))]
