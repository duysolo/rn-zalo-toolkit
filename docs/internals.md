# Ghi chú nội bộ

File này dành cho người bảo trì thư viện, không dành cho người dùng. Nó ghi lại lý do đằng sau
những quyết định trông kỳ, để lần sau không ai "dọn dẹp" chúng đi.

## SDK iOS lấy qua SPM

Zalo không phát hành SDK iOS qua Swift Package Manager - repo chính hãng `VNG-Zalo/ZaloSDK-iOS`
chỉ có `ZaloSDK.podspec`. Nên ta tự bọc xcframework thành Swift Package:

```
ios/ZaloSDKBinary/Package.swift    → binaryTarget cho ZaloSDK + ZaloSDKCoreKit
```

Podspec của thư viện không khai `s.dependency` bên thứ ba nào, chỉ trỏ `vendored_frameworks` vào
xcframework đó. CI có job riêng canh việc này (`no-cocoapods-dependency`).

React Native 0.85 vẫn autolink native module qua CocoaPods nên podspec vẫn phải tồn tại. Khi React
Native hỗ trợ autolink bằng SPM thì xoá podspec đi được, không đụng dòng Swift nào.

**Bẫy đã gặp:** CocoaPods áp `exclude_files` cho MỌI attribute nhận file pattern, kể cả
`vendored_frameworks`. Một `s.exclude_files` tưởng vô hại đã âm thầm loại luôn xcframework khỏi
build. Vì vậy `source_files` dùng glob một cấp và không có `exclude_files`.

**Bẫy thứ hai:** `Info.plist` của xcframework phải là `xml1`. Script vendor từng ghi `binary1` và
`pod install` chết với `invalid byte sequence in UTF-8`.

## Nâng version SDK Zalo

```sh
# 1. Sửa sdkVersions trong packages/rn-zalo-toolkit/package.json
npm run vendor:sync     # tải lại xcframework, tự cắt slice không dùng
npm run check:zalosdk   # kiểm tra binary
```

`npm run check:upstream` báo khi Zalo ra bản mới, chạy sẵn theo lịch trong CI.

Slice `armv7`/`i386` được cắt bỏ: 26MB xuống 16MB. An toàn vì đây là static archive.

## Hai thứ đang canh trong binary iOS

`npm run check:zalosdk` cảnh báo hai điểm. Chúng không chặn build, nhưng nếu thành lỗi thật thì
phải xem lại việc bọc SDK chính hãng:

1. Slice cho thiết bị vẫn dùng `LC_VERSION_MIN_IPHONEOS` (minos 9.0), định dạng có từ trước
   Xcode 11.
2. Binary tham chiếu cứng `SFAuthenticationSession`, deprecated từ iOS 12. Nếu Apple gỡ khỏi
   runtime thì app chết ngay lúc launch (dyld). Đây không phải lỗi build nên không CI nào bắt
   được.

## Vì sao mọi promise phải đi qua `PromiseGate`

SDK Zalo không có cơ chế chống settle hai lần. Tệ hơn: `-[ZaloSDK handleDidBecomeActive]` là no-op
(kiểm bằng `otool -tV`, đúng một lệnh `ret`), nghĩa là SDK không đối chiếu gì khi app quay lại
foreground.

Nếu user rời sang Zalo rồi bỏ ngang, không có ai khác phát hiện được. Timeout trong `PromiseGate`
là lưới duy nhất.

Timer trên iOS là `DispatchQueue.main.asyncAfter` nên không chạy khi app bị suspend - đó là lý do
docs khuyên app giữ thêm một timeout ở JS.

## Mọi lời gọi SDK phải ở main thread, không có ngoại lệ

Method của TurboModule chạy trên hàng đợi nền
(`com.meta.react.turbomodulemanager.queue`). Gọi `[ZaloSDK unauthenticate]` thẳng trên hàng đợi đó
làm corrupt bộ nhớ Hermes và crash app - đã có app production phải gỡ hẳn chức năng đăng xuất Zalo
để né.

Vì vậy mỗi entry point native bắt đầu bằng `onMain { }`, kể cả những hàm trông nhẹ như
`unauthenticate` và `getVersion`. Android cũng làm tương tự bằng `UiThreadUtil.runOnUiThread`.

## Bảng mã lỗi có một nguồn duy nhất

`src/errorTable.json` là nguồn, ba bộ test đọc chính file đó:

| Bộ test | Kiểm |
|---|---|
| `src/__tests__/errorTable.test.ts` | union `ZaloErrorCode` phủ đúng bảng |
| `src/__tests__/enums.test.ts` | enum tồn tại ở runtime, khớp bảng |
| `android/src/test/kotlin/.../ErrorMappingTest.kt` | `ErrorMapping.kt` khớp mọi dòng Android |
| `ios/Tests/ErrorMappingTests.swift` | `ErrorMapping.swift` khớp mọi dòng iOS |

Thêm mã mới mà quên một phía thì CI đỏ ngay.

Trường `platform` trong bảng có ba giá trị: `android`, `ios`, `both`. Nó KHÔNG phải `ZaloPlatform`
(chỉ có ios/android) - hai khái niệm khác nhau, và việc gộp chúng lại chính là cái bẫy đã sinh ra
vụ `-7014`/`-7015`.

`-1001` trên iOS không có trong `ZDKZaloError.h` nhưng demo chính hãng của Zalo lại dùng nó làm
mốc "không phải cancel". Nghĩa là header không phải nguồn đầy đủ, tập mã cancel là tập mở.

## Vì sao build fail khi thiếu `zaloAppId`

`aapt2` **chấp nhận** chuỗi rỗng. Nếu chỉ dựa vào `manifestPlaceholders` với mặc định rỗng thì
build vẫn xanh và sinh ra `android:scheme="zalo-"`, lỗi chỉ lộ khi Zalo từ chối đăng nhập trên máy
user.

Có job CI riêng (`android-missing-appid-must-fail`) canh đúng quyết định này, để không ai "đơn giản
hoá" bằng cách bỏ khối kiểm trong `build.gradle`.

## Vì sao thư viện tự thêm Maven repo vào app

`repositories {}` khai trong một library module không đủ để app resolve runtime classpath - build
chết với `Could not find me.zalo:sdk-auth`. Nên thư viện chèn repo vào `rootProject.allprojects`,
có cờ `rnZaloToolkitSkipRepoInjection` cho app muốn tự quản.

Cũng phải khai `me.zalo:sdk-core` tường minh: `implementation` không đưa dependency gián tiếp lên
compile classpath, nên `ZaloOAuthResultCode` và `AppInfo` sẽ không resolve được.

## Vì sao spec TurboModule chỉ nhận và trả JSON string

Codegen của React Native chỉ đỡ một tập kiểu hẹp. `Record<K, V>` làm build chết với
`UnsupportedGenericParserError`, không phải cảnh báo. Nên spec native truyền JSON string, còn kiểu
thật sống ở `src/types.ts`.

Hệ quả: phía native **phải** resolve bằng string. Trên iOS, resolve thẳng một `NSDictionary` sẽ làm
`JSON.parse` ở JS nhận object, ép thành `"[object Object]"` rồi ném - tức mọi lời gọi đều hỏng.
Dùng `succeedJSON` / `JSONPayload.string`, đừng resolve dictionary.

Tên class codegen sinh ra lấy từ **tên file spec**, không phải từ `codegenConfig.name`. Đổi tên
file là đổi tên class.

## Bẫy `org.json` trên Android

Bản AOSP khác bản Maven dùng trong unit test ở hai điểm:

- `optString(key)` trả về chuỗi `"null"` khi giá trị là JSON null, không trả `""`.
- `put(key, null)` **xoá** key thay vì đặt giá trị null.

`Json.kt` bọc lại hai chỗ này. Unit test dùng `org.json:json` từ Maven nên KHÔNG tái hiện được
hai hành vi trên - đừng tin test là đủ ở đây.

## iOS lọc `fields` ở phía client

`getZaloUserProfileWithAccessToken:callback:` không nhận danh sách field. Để hai nền tảng trả cùng
một tập dữ liệu, iOS lọc kết quả ở phía mình, kể cả trong `raw`. Nghĩa là xin ít field thì thật sự
nhận ít, nhưng dữ liệu vẫn đã đi qua mạng.

## Enum khai bằng `const` object

Không dùng `enum` của TypeScript vì React Native transpile bằng Babel: `const enum` không chạy
được, còn `enum` thường sinh code runtime và vi phạm `erasableSyntaxOnly`.

Đổi lại phải tắt `no-redeclare` trong eslint - value và type trùng tên là hợp lệ trong TypeScript
nhưng cả rule base lẫn bản TS-aware đều không có option chấp nhận. `tsc` mới là thứ bắt redeclare
thật.

`src/__tests__/enums.test.ts` canh việc enum tồn tại ở runtime: nếu ai đó đổi export thành
`type ZaloErrorCode` thì repo này vẫn typecheck xanh, nhưng app dùng `ZaloErrorCode.CANCELLED` sẽ
chết lúc chạy.
