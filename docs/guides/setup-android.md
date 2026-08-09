# Cài đặt - Android

## Một dòng duy nhất

`android/gradle.properties`:

```properties
zaloAppId=1993903030729882479
```

Xong. Cụ thể là bạn **không** phải làm những việc mà `react-native-zalo-kit` bắt làm:

| Việc cũ | Bây giờ |
|---|---|
| `ZaloSDKApplication.wrap(this)` trong `MainApplication` | thư viện tự làm qua `ContentProvider` |
| `ZaloSDK.Instance.onActivityResult(...)` trong `MainActivity` | thư viện tự đăng ký `ActivityEventListener` |
| khai `<meta-data com.zing.zalo.zalosdk.appID>` | thư viện khai, đọc từ `zaloAppId` |
| khai `<activity BrowserLoginActivity>` + scheme | thư viện khai, scheme sinh từ `zaloAppId` |
| khai `<queries><package com.zing.zalo/>` | AAR của Zalo đã tự khai |
| thêm proguard rule cho `com.zing.zalo.**` | thư viện ship `consumer-rules.pro` |
| thêm repo Maven của Zalo vào app | thư viện tự tiêm |

Nếu app bạn đang có bất kỳ dòng nào ở cột trái, **xoá đi** - xem
[hướng dẫn chuyển đổi](./migrate-from-react-native-zalo-kit.md).

## Khai sai thì build fail, không phải treo

Bỏ `zaloAppId` đi rồi build thử:

```
> rn-zalo-toolkit: thiếu hoặc sai `zaloAppId` (đang là: '').

  Thêm vào android/gradle.properties của app:
      zaloAppId=1993903030729882479
  ...
```

Đây là chủ đích. `aapt2` **chấp nhận** chuỗi rỗng: nếu chỉ dựa vào `manifestPlaceholders` với
giá trị mặc định rỗng thì build sẽ xanh và sinh ra `android:scheme="zalo-"` hoàn toàn im lặng -
lỗi chỉ lộ khi Zalo từ chối đăng nhập trên máy người dùng thật.

## App nhiều brand (white-label)

Mỗi brand thường có Zalo app id riêng. Script đổi brand chỉ cần ghi một dòng vào
`android/gradle.properties`:

```bash
if grep -q '^zaloAppId=' "$GRADLE_PROPS"; then
    sed -i '' -E "s|^zaloAppId=.*|zaloAppId=${ZALO_APP_ID}|" "$GRADLE_PROPS"
else
    printf '\nzaloAppId=%s\n' "$ZALO_APP_ID" >> "$GRADLE_PROPS"
fi
```

⚠️ Phải **upsert**, không chỉ `sed`: lần đầu chưa có dòng nào để thay.

Sau khi đổi brand, chạy `npx rn-zalo-toolkit-doctor` để chắc iOS và Android không lệch app id -
đó là lỗi mà kiểm tra runtime không bao giờ thấy, vì mỗi lần chạy chỉ thấy một nền tảng.

## Hash key - nguyên nhân số một của `INVALID_CONFIG`

Zalo ràng buộc app bằng **package name + hash key của chứng chỉ ký**. Hash key là
`base64(SHA-1(chứng chỉ))`, **không phải SHA-256**.

Lấy đúng chuỗi mà SDK gửi lên:

```ts
console.log(await getApplicationHashKey())
```

Hoặc đọc từ chính lỗi - `INVALID_CONFIG` đã kèm sẵn:

```ts
catch (error) {
  if (ZaloError.is(error, 'INVALID_CONFIG')) {
    console.log(error.signatureHashKey, error.packageName)
  }
}
```

**Bẫy hay gặp nhất:** mỗi loại build ký bằng một khoá khác nhau, nên cần đăng ký nhiều hash key:

| Loại build | Khoá ký | Ghi chú |
|---|---|---|
| debug / chạy local | `android/app/debug.keystore` | |
| APK tự ký | upload keystore của bạn | |
| **bản từ Play Store** | **App Signing key của Google** | Google ký lại - hash **khác** upload key |

Bản trên Play Store dùng App Signing key, nên lấy SHA-1 ở
**Play Console → Test and release → App integrity → App signing key certificate**, không phải
"Upload key certificate". Đăng ký nhầm cái thứ hai cho ra `invalid android signkey`, và Zalo
hiển thị nó dưới dạng hộp thoại *"Bản Zalo không tương thích"* - một thông báo không liên quan gì
tới nguyên nhân thật.

`verifyInstallation()` báo cáo thêm `signersCurrent` (chứng chỉ hiện hành, API 28+). Trường đó
**chỉ để chẩn đoán việc đã rotate khoá** - giá trị phải dán lên portal luôn là `signatureHashKey`.

## Bản release có minify

Thư viện ship `consumer-rules.pro` giữ `com.zing.zalo.**`, vì SDK Zalo tự phản chiếu lớp của nó
theo tên (`Class.forName("com.zing.zalo.zalosdk.oauth.ZaloSDKApplication")`). R8 đổi tên lớp
nhưng không đổi chuỗi ⇒ `ClassNotFoundException`, và **chỉ ở bản release**.

Nếu app bạn đang có rule tương tự, xoá đi - thư viện lo rồi.

## Permission được merge vào app

AAR của Zalo tự thêm hai permission, biết trước để không ngạc nhiên khi review:

- `android.permission.INTERNET`
- `com.zing.zalo.permission.ACCESS_THIRD_PARTY_APP_AUTHORIZATION`

## Khai báo dữ liệu trên Play Console

Google tính cả dữ liệu do SDK bên thứ ba thu thập. SDK Zalo có module theo dõi thiết bị
(`DeviceTracking`) chạy khi khởi tạo. Tối thiểu cần khai **Device or other IDs**.

## Muốn tự quản repo Maven

Thư viện tự tiêm repo của Zalo vào app vì `repositories {}` trong một module library **không**
đủ cho app resolve runtime classpath (build sẽ chết với `Could not find me.zalo:sdk-auth`).
Muốn tự làm thì đặt ở `android/build.gradle` của app:

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
