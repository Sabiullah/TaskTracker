from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ClientClassificationViewSet,
    PaceChecklistViewSet,
    PaceGoalReviewViewSet,
    PaceGoalViewSet,
    PaceMeetingViewSet,
)

router = DefaultRouter()
router.register("pace_goals", PaceGoalViewSet, basename="pacegoal")
router.register("pace_goal_reviews", PaceGoalReviewViewSet, basename="pacegoalreview")
router.register("pace_meetings", PaceMeetingViewSet, basename="pacemeeting")
router.register("pace_checklist", PaceChecklistViewSet, basename="pacechecklist")
router.register("client_classifications", ClientClassificationViewSet, basename="clientclassification")

urlpatterns = [path("", include(router.urls))]
