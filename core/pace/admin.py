from django.contrib import admin

from .models import ClientClassification, PaceChecklist, PaceGoal, PaceGoalReview, PaceMeeting


@admin.register(PaceGoal)
class PaceGoalAdmin(admin.ModelAdmin):
    list_display = ["title", "goal_type", "status", "priority", "profile", "org"]
    list_filter = ["goal_type", "status", "priority"]
    search_fields = ["title", "description"]


@admin.register(PaceGoalReview)
class PaceGoalReviewAdmin(admin.ModelAdmin):
    list_display = ["goal", "review_date", "previous_rating", "new_rating", "reviewer_name"]
    list_filter = ["review_date"]


@admin.register(PaceMeeting)
class PaceMeetingAdmin(admin.ModelAdmin):
    list_display = ["title", "meeting_type", "scheduled_date", "status"]
    list_filter = ["meeting_type", "status"]
    search_fields = ["title"]


@admin.register(PaceChecklist)
class PaceChecklistAdmin(admin.ModelAdmin):
    list_display = ["fy", "week_number", "item_number", "action_item", "done"]
    list_filter = ["fy", "done"]


@admin.register(ClientClassification)
class ClientClassificationAdmin(admin.ModelAdmin):
    list_display = ["client", "classification", "revenue_tier", "risk_level", "org"]
    list_filter = ["classification", "risk_level"]
