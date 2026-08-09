// swift-tools-version:5.9
//
//  ZaloSDKBinary - bọc SDK iOS chính hãng của Zalo thành một Swift Package.
//
//  VÌ SAO GÓI NÀY TỒN TẠI
//  ----------------------
//  Zalo KHÔNG phát hành SDK iOS qua Swift Package Manager. Repo chính hãng
//  `VNG-Zalo/ZaloSDK-iOS` chỉ có `ZaloSDK.podspec` - không có `Package.swift`
//  (kiểm 2026-08-09: `raw.githubusercontent.com/.../Package.swift` trả 404).
//  Cách duy nhất để một dự án SPM dùng được SDK này là tự bọc xcframework lại,
//  và đó là việc của gói này.
//
//  Nhờ vậy `rn-zalo-toolkit` KHÔNG có bất kỳ dependency CocoaPods nào lên bên thứ ba:
//  không `pod 'ZaloSDK'`, không phụ thuộc CocoaPods trunk, không phụ thuộc CDN của nó.
//
//  BINARY ĐẾN TỪ ĐÂU
//  -----------------
//  `Frameworks/*.xcframework` được nạp bằng `scripts/sync-vendored-zalosdk.mjs`, đã cắt
//  các slice chết (`armv7`, `i386`) - xem phần đầu script đó để biết vì sao cắt được an toàn.
//  Giấy phép của Zalo là MIT, bản sao nằm ở `Frameworks/LICENSE-ZaloSDK`.
//
//  Version SDK là nguồn duy nhất ở `package.json` → `sdkVersions.ios.zaloSdk`.
//  `scripts/check-upstream-versions.mjs` báo khi Zalo ra bản mới.
//
//  DÙNG BẢN HOSTED THAY VÌ VENDOR
//  ------------------------------
//  Nếu về sau muốn bỏ 16MB binary khỏi npm/git, đổi hai `binaryTarget` bên dưới sang
//  dạng `url:` + `checksum:` (tạo zip bằng chính script sync rồi `swift package
//  compute-checksum`). Phần còn lại của gói không đổi.
//
import PackageDescription

let package = Package(
    name: "ZaloSDKBinary",
    platforms: [
        // 15.1 = `min_ios_version_supported` của React Native 0.85, tức mức thấp nhất
        // trong các app tiêu thụ. Đặt 16.0 khiến app nào còn ở 15.1 KHÔNG `pod install`
        // được, và lỗi đó chỉ lộ ở một trong hai app nên CI/example không bao giờ thấy.
        // Không có API nào trong Swift của thư viện cần iOS 16.
        .iOS(.v15)
    ],
    products: [
        .library(
            name: "ZaloSDKBinary",
            targets: ["ZaloSDK", "ZaloSDKCoreKit"]
        )
    ],
    targets: [
        // ZaloSDK phụ thuộc ZaloSDKCoreKit. SPM không mô tả được quan hệ giữa hai
        // binaryTarget, nên cả hai được phơi cùng lúc qua một product - linker tự lo
        // thứ tự vì đây là thư viện TĨNH.
        .binaryTarget(
            name: "ZaloSDK",
            path: "Frameworks/ZaloSDK.xcframework"
        ),
        .binaryTarget(
            name: "ZaloSDKCoreKit",
            path: "Frameworks/ZaloSDKCoreKit.xcframework"
        ),
    ]
)
