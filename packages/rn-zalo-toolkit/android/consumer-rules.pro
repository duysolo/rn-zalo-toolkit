# Quy tắc R8 đi kèm thư viện - app tiêu thụ tự động nhận, không phải chép tay.
#
# VÌ SAO BẮT BUỘC: Zalo SDK tự phản chiếu chính lớp của nó THEO TÊN.
# `javap -c com.zing.zalo.zalosdk.core.helper.Utils` cho thấy:
#     Class.forName("com.zing.zalo.zalosdk.oauth.ZaloSDKApplication").getMethod("wrap")
#     Class.forName("com.zing.zalo.devicetrackingsdk.ZingAnalyticsManager")
# R8 đổi tên lớp nhưng KHÔNG đổi chuỗi trong hằng số → ClassNotFoundException.
#
# Hạng lỗi này CHỈ xuất hiện ở bản release có minify, nên nó không bao giờ lộ ra khi chạy
# debug. Một app production trong hệ này đang chạy Zalo SDK bị minify mà không có rule nào -
# thư viện ship rule ở đây là sửa lỗi tiềm ẩn đó, không phải chuyển chỗ nó.
-keep class com.zing.zalo.** { *; }
-keep enum com.zing.zalo.** { *; }
-keep interface com.zing.zalo.** { *; }

# `sdk-openapi` cố tình KHÔNG được kéo vào (nó chỉ chứa feed/share, ngoài phạm vi auth),
# nhưng classes.jar của sdk-auth có tham chiếu chuỗi tới vài lớp trong đó. Không có dòng
# này thì R8 cảnh báo missing class ở mọi bản release.
-dontwarn com.zing.zalo.zalosdk.oauth.**
-dontwarn com.zing.zalo.**
