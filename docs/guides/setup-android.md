# Setup - Android

## Chỉ một dòng

`android/gradle.properties`:

```properties
zaloAppId=1993903030729882479
```

Xong. Thư viện tự lo phần còn lại:

| Việc | Ai làm |
|---|---|
| Khởi tạo SDK lúc app start | thư viện, qua `ContentProvider` |
| `onActivityResult` cho luồng login | thư viện, qua `ActivityEventListener` |
| `<meta-data com.zing.zalo.zalosdk.appID>` | thư viện khai, đọc từ `zaloAppId` |
| `<activity BrowserLoginActivity>` + URL scheme | thư viện khai, scheme sinh từ `zaloAppId` |
| `<queries><package com.zing.zalo/>` | AAR của Zalo đã khai sẵn |
| Proguard rule cho `com.zing.zalo.**` | thư viện ship `consumer-rules.pro` |
| Maven repo của Zalo | thư viện tự thêm vào app |

Nếu app bạn đang tự làm bất kỳ dòng nào ở trên thì xoá đi, để tránh trùng lặp.

## Khai sai thì build fail

Bỏ `zaloAppId` rồi build thử:

```
> rn-zalo-toolkit: thiếu hoặc sai `zaloAppId` (đang là: '').

  Thêm vào android/gradle.properties của app:
      zaloAppId=1993903030729882479
```

Sở dĩ phải check thủ công là vì `aapt2` chấp nhận chuỗi rỗng. Nếu chỉ dựa vào
`manifestPlaceholders` với giá trị mặc định rỗng thì build vẫn xanh và sinh ra
`android:scheme="zalo-"`, và lỗi chỉ lộ khi Zalo từ chối đăng nhập trên máy user.

## App nhiều brand (white-label)

Mỗi brand thường có Zalo app id riêng. Script đổi brand chỉ cần ghi một dòng:

```bash
if grep -q '^zaloAppId=' "$GRADLE_PROPS"; then
    sed -i '' -E "s|^zaloAppId=.*|zaloAppId=${ZALO_APP_ID}|" "$GRADLE_PROPS"
else
    printf '\nzaloAppId=%s\n' "$ZALO_APP_ID" >> "$GRADLE_PROPS"
fi
```

Nhớ dùng upsert chứ không chỉ `sed`, vì lần đầu chưa có dòng nào để thay.

Sau khi đổi brand, chạy `npx rn-zalo-toolkit-doctor` để chắc app id của iOS và Android không
lệch nhau. Runtime không bắt được lỗi này vì mỗi lần chạy chỉ thấy một nền tảng.

## Hash key - nguyên nhân số một của `INVALID_CONFIG`

Zalo ràng buộc app bằng **package name + hash key của certificate ký app**. Hash key là
`base64(SHA-1(certificate))`, không phải SHA-256.

Lấy đúng chuỗi mà SDK gửi lên:

```ts
console.log(await getApplicationHashKey())
```

Hoặc đọc từ chính error, `INVALID_CONFIG` đã kèm sẵn:

```ts
catch (error) {
  if (ZaloError.is(error, ZaloErrorCode.INVALID_CONFIG)) {
    console.log(error.signatureHashKey, error.packageName)
  }
}
```

Mỗi loại build ký bằng một key khác nhau, nên thường phải đăng ký nhiều hash key:

| Loại build | Key ký | Ghi chú |
|---|---|---|
| debug / chạy local | `android/app/debug.keystore` | |
| APK tự ký | upload keystore của bạn | |
| Bản từ Play Store | App Signing key của Google | Google ký lại nên hash khác upload key |

Với bản trên Play Store, lấy SHA-1 ở **Play Console → Test and release → App integrity → App
signing key certificate**, không phải "Upload key certificate". Đăng ký nhầm sẽ ra
`invalid android signkey`, mà Zalo lại hiển thị dưới dạng hộp thoại *"Bản Zalo không tương
thích"* - nghe như lỗi phiên bản nhưng thực ra là lỗi hash key.

`verifyInstallation()` còn trả thêm `signersCurrent` (certificate hiện hành, API 28+). Trường
này chỉ để chẩn đoán xem key đã bị rotate chưa; giá trị cần dán lên portal luôn là
`signatureHashKey`.

## Build release có minify

SDK Zalo dùng reflection để load class theo tên
(`Class.forName("com.zing.zalo.zalosdk.oauth.ZaloSDKApplication")`). R8 đổi tên class nhưng không
đổi chuỗi, nên bản minify sẽ chết với `ClassNotFoundException`. Thư viện đã ship
`consumer-rules.pro` giữ lại `com.zing.zalo.**`, app không cần tự thêm rule.

Lỗi này chỉ xuất hiện ở build release, nên nhớ test bản release trước khi phát hành.

## Permission được merge vào app

AAR của Zalo tự thêm hai permission, biết trước để khỏi bất ngờ lúc review:

- `android.permission.INTERNET`
- `com.zing.zalo.permission.ACCESS_THIRD_PARTY_APP_AUTHORIZATION`

## Khai báo dữ liệu trên Play Console

Google tính cả dữ liệu do SDK bên thứ ba thu thập. SDK Zalo có module `DeviceTracking` chạy lúc
khởi tạo, nên tối thiểu cần khai **Device or other IDs**.

## Tự quản Maven repo

Thư viện tự thêm Maven repo của Zalo vào app, vì `repositories {}` khai trong một library module
không đủ để app resolve runtime classpath (build sẽ chết với `Could not find me.zalo:sdk-auth`).

Muốn tự quản thì tắt phần đó đi và khai ở `android/build.gradle` của app:

```gradle
ext { rnZaloToolkitSkipRepoInjection = true }

allprojects {
  repositories {
    maven {
      url "https://gitlab.com/api/v4/projects/50747855/packages/maven"
      content { includeGroup "me.zalo" }
    }
  }
}
```
