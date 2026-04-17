from rest_framework import serializers

from .models import AppSetting


class AppSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = AppSetting
        fields = ["id", "key", "value", "description", "updated_at"]
        read_only_fields = ["id", "updated_at"]
