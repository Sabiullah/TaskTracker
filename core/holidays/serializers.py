from rest_framework import serializers

from .models import Holiday


class HolidaySerializer(serializers.ModelSerializer):
    day = serializers.CharField(read_only=True)

    class Meta:
        model = Holiday
        fields = ["id", "uid", "name", "date", "day", "type", "created_at", "updated_at"]
        read_only_fields = ["id", "uid", "day", "created_at", "updated_at"]
