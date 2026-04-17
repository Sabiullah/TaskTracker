from django.contrib import admin

from .models import Task, TaskLog


class TaskLogInline(admin.TabularInline):
    model = TaskLog
    extra = 0
    readonly_fields = ["changed_by", "changed_at", "changes"]
    can_delete = False


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ["uid", "title", "client", "category", "status", "target_date", "responsible", "recurrence"]
    list_filter = ["status", "recurrence", "category"]
    search_fields = ["title", "description", "remarks"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["client", "category", "org", "responsible", "created_by"]
    date_hierarchy = "target_date"
    inlines = [TaskLogInline]


@admin.register(TaskLog)
class TaskLogAdmin(admin.ModelAdmin):
    list_display = ["task", "changed_by", "changed_at"]
    list_filter = ["changed_at"]
    readonly_fields = ["task", "changed_by", "changed_at", "changes"]
    search_fields = ["task__title", "task__description"]
