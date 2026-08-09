require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
sdk_versions = package["sdkVersions"]["ios"]

# ─────────────────────────────────────────────────────────────────────────────
#  KHÔNG CÓ MỘT DEPENDENCY COCOAPODS BÊN THỨ BA NÀO TRONG FILE NÀY.
#
#  Đây là điểm khác căn bản so với `react-native-zalo-kit`, thứ khai
#  `s.dependency "ZaloSDK"` và vì thế buộc mọi app phải kéo SDK Zalo từ CocoaPods
#  trunk. CocoaPods đã vào chế độ bảo trì; buộc một dependency mới vào nó năm 2026
#  là tự nhận nợ.
#
#  Thay vào đó, SDK Zalo được mô tả bằng một Swift Package thật:
#      ios/ZaloSDKBinary/Package.swift
#  Gói đó khai hai `binaryTarget` trỏ vào xcframework đã vendor (Zalo KHÔNG phát hành
#  SPM chính hãng - repo `VNG-Zalo/ZaloSDK-iOS` chỉ có podspec), và nó dùng được ngay
#  hôm nay bởi bất kỳ dự án SPM nào.
#
#  Podspec này vẫn tồn tại vì MỘT lý do duy nhất: React Native 0.85 vẫn autolink
#  native module qua CocoaPods (`use_native_modules!`). Nó chỉ trỏ `vendored_frameworks`
#  vào ĐÚNG những xcframework mà Package.swift kia mô tả - một bản sao binary, hai cách
#  mô tả. Ngày RN hỗ trợ autolink bằng SPM, xoá file này đi là xong, không phải đụng
#  một dòng Swift nào.
#
#  Muốn để chính Pods project tham chiếu SPM package (thay vì vendored_frameworks),
#  đặt biến này trong Podfile TRƯỚC target block:
#      $RnZaloToolkitUseSPM = true
#  Khi đó `spm_dependency` của RN 0.85 sẽ gắn gói local vào Pods project. Đường này
#  gần với tương lai hơn nhưng ĐANG THỬ NGHIỆM: `XCLocalSwiftPackageReference` lưu
#  đường dẫn dạng chuỗi, nên nó nhạy với vị trí `node_modules` và với CI có layout khác.
#  Mặc định để tắt cho tới khi chạy được qua ma trận nghiệm thu trên máy thật.
# ─────────────────────────────────────────────────────────────────────────────

Pod::Spec.new do |s|
  s.name         = "RnZaloToolkit"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/duysolo/rn-zalo-toolkit"
  s.license      = package["license"]
  s.authors      = "duysolo"
  s.platforms    = { :ios => sdk_versions["iosTarget"] }
  s.source       = { :git => "https://github.com/duysolo/rn-zalo-toolkit.git", :tag => "v#{s.version}" }

  # Chỉ lấy source ở TẦNG GỐC của `ios/`. Cố tình KHÔNG dùng `exclude_files`.
  #
  # CocoaPods áp `exclude_files` cho MỌI file-pattern attribute, kể cả
  # `vendored_frameworks` - xem `Sandbox::FileAccessor#paths_for_attribute`, nó truyền
  # `:exclude_patterns => spec_consumer.exclude_files` vào mọi lời gọi. Nghĩa là một dòng
  # `exclude_files = "ios/ZaloSDKBinary/**/*"` sẽ xoá SẠCH hai xcframework khỏi pod, KHÔNG
  # một cảnh báo nào, và Swift chết bằng `no such module 'ZaloSDK'`.
  #
  # Glob một tầng loại sẵn đúng hai thứ cần loại, không cần `exclude_files`:
  #   - `ios/Tests/**`         : file XCTest. Lọt vào là `import XCTest` làm hỏng build của
  #                              MỌI app cài thư viện này.
  #   - `ios/ZaloSDKBinary/**` : Package.swift + ~100 header của xcframework.
  s.source_files = "ios/*.{h,m,mm,swift}"

  # `.xcprivacy` không khớp glob của `source_files`, nên nếu khai ở đó thì file bị bỏ
  # im lặng và app sẽ thiếu manifest lúc submit. `resource_bundles` là đường đúng.
  s.resource_bundles = { "RnZaloToolkitPrivacyInfo" => ["ios/PrivacyInfo.xcprivacy"] }

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "SWIFT_VERSION" => "5.9",
    # Version của THƯ VIỆN, tiêm lúc biên dịch - tương ứng `BuildConfig.TOOLKIT_VERSION`
    # bên Android. Không tiêm thì `.mm` phải đọc `[NSBundle bundleForClass:]`, mà với pod
    # link tĩnh (mặc định React Native) bundle đó là main bundle ⇒ báo nhầm version
    # MARKETING CỦA APP thay vì của thư viện.
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) RNZT_VERSION=\\\"#{s.version}\\\"",
  }

  # KHÔNG copy khối guard `$RNFirebaseDisableSPM` của `rn-sql-connect` vào đây.
  # Podspec đó `raise` khi thiếu biến ấy, và một app không dùng Firebase-qua-SPM sẽ
  # `pod install` hỏng với lý do nói về Firebase - hoàn toàn không liên quan Zalo.
  install_modules_dependencies(s)

  if defined?($RnZaloToolkitUseSPM) && $RnZaloToolkitUseSPM == true
    unless defined?(spm_dependency)
      raise <<~ERROR
        [rn-zalo-toolkit] $RnZaloToolkitUseSPM = true cần React Native 0.85 trở lên
        (hàm `spm_dependency` chỉ có từ bản đó). Bỏ biến này hoặc nâng React Native.
      ERROR
    end
    spm_dependency(s,
      url: File.join(__dir__, "ios", "ZaloSDKBinary"),
      requirement: { kind: "branch", branch: "main" },
      products: ["ZaloSDKBinary"]
    )
  else
    # Đường mặc định: dùng chính xcframework mà Package.swift mô tả. Một nguồn binary,
    # không nhân bản.
    s.vendored_frameworks = [
      "ios/ZaloSDKBinary/Frameworks/ZaloSDK.xcframework",
      "ios/ZaloSDKBinary/Frameworks/ZaloSDKCoreKit.xcframework",
    ]
    s.preserve_paths = "ios/ZaloSDKBinary/**/*"
  end

  # SDK Zalo cần các framework hệ thống này. Trước đây chúng đến gián tiếp qua pod
  # `ZaloSDK`; giờ không còn pod đó nên phải khai tường minh.
  s.frameworks = "UIKit", "Foundation", "Security", "SafariServices", "WebKit",
                 "SystemConfiguration", "CoreTelephony", "AuthenticationServices"
  # `sqlite3` KHÔNG cần: `nm -u` trên cả hai xcframework không có symbol `sqlite3_*`.
  s.libraries = "z"
end
