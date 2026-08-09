// Lớp keo TurboModule. Giữ mỏng NHẤT có thể - toàn bộ logic nằm ở Swift
// (`RnZaloToolkitCore.swift`), lớp này chỉ dịch kiểu và chọn view controller.
//
// VÌ SAO PHẢI LÀ .mm CHỨ KHÔNG PHẢI SWIFT THUẦN:
// header spec do codegen sinh ra phải biên dịch bằng Obj-C++. Nếu import nó từ một header
// public, module map sẽ phơi nó cho Swift, Swift biên dịch như Obj-C thuần và fail
// *"This file must be compiled as Obj-C++"*. Vì vậy Swift KHÔNG conform trực tiếp
// `NativeRnZaloToolkitSpec` được; keo phải nằm ở đây.

#import <React/RCTInvalidating.h>
#import <React/RCTUtils.h>
#import <RnZaloToolkitSpec/RnZaloToolkitSpec.h>

#if __has_include(<RnZaloToolkit/RnZaloToolkit-Swift.h>)
#import <RnZaloToolkit/RnZaloToolkit-Swift.h>
#else
#import "RnZaloToolkit-Swift.h"
#endif

// `RCTInvalidating` là BẮT BUỘC để React gọi `-invalidate`. Không khai thì method dưới đây
// tồn tại mà không ai gọi, và state của phiên login sống sót qua vòng đời React context.
@interface RnZaloToolkit : NativeRnZaloToolkitSpecBase <NativeRnZaloToolkitSpec, RCTInvalidating>
@end

@implementation RnZaloToolkit {
  RnZaloToolkitCore *_core;
}

RCT_EXPORT_MODULE()

/// Khởi tạo SDK sớm nhất có thể.
///
/// KHÔNG dùng `+load`: `RCT_EXPORT_MODULE()` đã tự sinh một `+load` (nhánh
/// `RCT_DISABLE_STATIC_MODULE_REGISTRATION` trong `RCTBridgeModule.h`), nên khai thêm là
/// `duplicate declaration of method 'load'` - lỗi biên dịch cứng.
///
/// `__attribute__((constructor))` chạy cùng thời điểm (lúc dyld nạp image) mà không đụng
/// runtime Objective-C. Gọi ĐỒNG BỘ, không `dispatch_async`: nếu đẩy sang main queue thì
/// block chỉ chạy khi run loop quay lần đầu, tức SAU `didFinishLaunchingWithOptions` - mất
/// đúng cái sớm mà ta cần. `ensureInitialised` tự lo phần main-queue của nó.
__attribute__((constructor)) static void RnZaloToolkitBootstrapOnLoad(void) {
  [RnZaloToolkitBootstrap bootstrap];
}

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (instancetype)init {
  if (self = [super init]) {
    _core = [RnZaloToolkitCore shared];
    __weak __typeof(self) weakSelf = self;
    [_core setEmitOauthCodeReceived:^(NSString *attemptId) {
      __typeof(self) strongSelf = weakSelf;
      if (strongSelf == nil) {
        return;
      }
      [strongSelf emitOnOauthCodeReceived:@{@"attemptId" : attemptId ?: @""}];
    }
                          forOwner:self];
  }
  return self;
}

/// `RCTInvalidating`. Được gọi khi React instance biến mất - kể cả mỗi lần Fast Refresh.
///
/// `_core` là singleton process-wide, nên phải dọn tường minh: nhả emitter (chỉ khi nó vẫn
/// là của MÌNH - Fast Refresh dựng instance mới trước khi huỷ instance cũ), settle phiên
/// login đang dở, và xoá token trong RAM. Không làm thì token sống qua teardown và
/// `LOGIN_IN_PROGRESS` kẹt tới khi timeout cũ nổ.
///
/// KHÔNG gọi `[super invalidate]`: `NativeRnZaloToolkitSpecBase` kế thừa thẳng `NSObject`.
- (void)invalidate {
  [_core teardownForOwner:self];
}

- (void)login:(NSString *)optionsJson
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject {
  // Method của TurboModule chạy trên hàng đợi nền
  // (`com.meta.react.turbomodulemanager.queue`), mà `RCTPresentedViewController()` đọc
  // `connectedScenes`/`keyWindow` - toàn UIKit main-thread-only. Phải nhảy về main queue,
  // nếu không Main Thread Checker sẽ bắt và giá trị trả về có thể sai.
  RCTExecuteOnMainQueue(^{
    // `RCTPresentedViewController()` của RN 0.85 đã làm đúng hai việc ta cần: `RCTKeyWindow()`
    // duyệt `connectedScenes`, lọc `UIWindowScene`, ưu tiên scene foreground (đúng chuẩn
    // iOS 15+), rồi đi hết chuỗi `presentedViewController` bỏ qua VC đang bị dismiss.
    // TUYỆT ĐỐI không tự viết `keyWindow`: deprecated từ iOS 13 và sai hẳn với app có scene
    // CarPlay - thứ không phải `UIWindowScene`.
    UIViewController *presenter = RCTPresentedViewController();
    [self->_core loginWithOptionsJSON:optionsJson
                            presenter:presenter
                              resolve:resolve
                               reject:reject];
  });
}

- (void)exchangeOAuthCode:(NSString *)oauthCode
             codeVerifier:(NSString *)codeVerifier
                  resolve:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject {
  [_core exchangeOAuthCodeWithOauthCode:oauthCode
                           codeVerifier:codeVerifier
                                resolve:resolve
                                 reject:reject];
}

- (void)refreshTokens:(NSString *)refreshToken
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject {
  [_core refreshTokensWithRefreshToken:refreshToken resolve:resolve reject:reject];
}

- (void)isRefreshTokenValid:(NSString *)refreshToken
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
  [_core isRefreshTokenValidWithRefreshToken:refreshToken resolve:resolve reject:reject];
}

- (void)logout:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [_core logoutWithResolve:resolve reject:reject];
}

- (void)getProfile:(NSString *)optsJson
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject {
  [_core getProfileWithOptsJSON:optsJson resolve:resolve reject:reject];
}

- (void)verifyInstallation:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject {
  [_core verifyInstallationWithResolve:resolve reject:reject];
}

- (void)getApplicationHashKey:(RCTPromiseResolveBlock)resolve
                       reject:(RCTPromiseRejectBlock)reject {
  [_core getApplicationHashKeyWithResolve:resolve reject:reject];
}

- (void)getSdkVersion:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject {
  // Version của THƯ VIỆN, tiêm lúc biên dịch từ podspec - giống hệt cách Android lấy
  // `BuildConfig.TOOLKIT_VERSION` từ package.json.
  //
  // KHÔNG đọc `[NSBundle bundleForClass:]`: với pod link tĩnh (mặc định của React Native)
  // lớp này nằm trong binary của app, nên bundle đó là main bundle và ta sẽ báo version
  // MARKETING CỦA APP thay vì của thư viện.
#ifdef RNZT_VERSION
  NSString *toolkitVersion = @RNZT_VERSION;
#else
  NSString *toolkitVersion = @"unknown";
#endif
  [_core getSdkVersionWithToolkitVersion:toolkitVersion resolve:resolve reject:reject];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeRnZaloToolkitSpecJSI>(params);
}

@end
