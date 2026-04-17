from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ChatMemberViewSet, ChatMessageViewSet, ChatRoomViewSet

router = DefaultRouter()
router.register("chat_rooms", ChatRoomViewSet, basename="chatroom")
router.register("chat_members", ChatMemberViewSet, basename="chatmember")
router.register("chat_messages", ChatMessageViewSet, basename="chatmessage")

urlpatterns = [path("", include(router.urls))]
