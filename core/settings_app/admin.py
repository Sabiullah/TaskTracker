from django.contrib import admin

from .models import ApkRelease, AppSetting


@admin.register(AppSetting)
class AppSettingAdmin(admin.ModelAdmin):
    list_display = ["key", "value", "description", "updated_at"]
    search_fields = ["key", "description"]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(ApkRelease)
class ApkReleaseAdmin(admin.ModelAdmin):
    list_display = ["version", "remarks", "updated_at"]
    search_fields = ["version", "remarks"]
    readonly_fields = ["created_at", "updated_at"]
