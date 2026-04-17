from django.contrib import admin

from .models import AppSetting


@admin.register(AppSetting)
class AppSettingAdmin(admin.ModelAdmin):
    list_display = ["key", "value", "description", "updated_at"]
    search_fields = ["key", "description"]
    readonly_fields = ["created_at", "updated_at"]
