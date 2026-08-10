import Foundation
import UIKit
import ZaloSDK

/// Lõi logic của `rn-zalo-toolkit` trên iOS.
///
/// Lớp này KHÔNG chạm bất kỳ kiểu nào của React Native - `.mm` mỏng bên cạnh lo phần đó và
/// truyền vào đây view controller đã chọn sẵn.
///
/// QUY TẮC LUỒNG - đọc trước khi sửa bất cứ dòng nào:
/// MỌI lời gọi vào `ZaloSDK.sharedInstance()` phải nằm trên main queue, **kể cả
/// `unauthenticate` và `getVersion`**. Method của TurboModule chạy trên hàng đợi nền
/// (`com.meta.react.turbomodulemanager.queue`), nên mỗi entry point ở đây bắt đầu bằng
/// `onMain { }` - không có ngoại lệ "hàm này nhẹ".
///
/// Đây không phải cẩn thận thừa: gọi `[ZaloSDK unauthenticate]` thẳng trên hàng đợi
/// TurboModule làm corrupt bộ nhớ Hermes và crash app. Đã có app production phải gỡ hẳn
/// chức năng đăng xuất Zalo để né lỗi này.
@objc(RnZaloToolkitCore)
public final class RnZaloToolkitCore: NSObject {
    public typealias Resolve = (Any?) -> Void
    public typealias Reject = (String?, String?, Error?) -> Void

    @objc public static let shared = RnZaloToolkitCore()

    private let stateLock = NSLock()
    private var loginGate: PromiseGate?
    private var currentAttemptId: String?
    /// Access token của phiên `login()` gần nhất, chỉ sống trong RAM. KHÔNG persist.
    private var sessionAccessToken: String?
    private var initialised = false

    /// Emit sự kiện lên JS, kèm chủ sở hữu.
    ///
    /// Core là singleton process-wide còn TurboModule thì bị dựng lại mỗi lần Fast Refresh.
    /// Không gắn chủ sở hữu thì instance cũ lúc `invalidate` sẽ xoá luôn block của instance
    /// mới, và sự kiện chết im lặng.
    private var emitOwner: AnyObject?
    private var emitBlock: ((String) -> Void)?

    private let oauthDelegate = ZaloOAuthDelegate()

    /// Chạy trên main queue. Đã ở main thì chạy ngay - tránh trễ một vòng run loop không cần.
    private func onMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
    }

    // MARK: - Vòng đời

    @objc public func setEmitOauthCodeReceived(_ block: ((String) -> Void)?, forOwner owner: AnyObject) {
        stateLock.lock()
        emitOwner = owner
        emitBlock = block
        stateLock.unlock()
    }

    /// Dọn khi React context biến mất. Chỉ dọn nếu `owner` vẫn là chủ hiện tại.
    @objc public func teardown(forOwner owner: AnyObject) {
        stateLock.lock()
        let isCurrentOwner = emitOwner === owner
        if isCurrentOwner {
            emitOwner = nil
            emitBlock = nil
        }
        let gate = loginGate
        stateLock.unlock()

        guard isCurrentOwner else { return }

        // Phiên login đang dở phải được settle, nếu không `LOGIN_IN_PROGRESS` kẹt tới khi
        // timeout cũ nổ (tối đa 120 giây).
        gate?.fail(ErrorMapping.simple(
            .cancelled, phase: .authorize,
            message: "Phiên đăng nhập bị huỷ vì React context đã bị huỷ."
        ))

        stateLock.lock()
        sessionAccessToken = nil
        loginGate = nil
        currentAttemptId = nil
        stateLock.unlock()
    }

    /// Nạp appId từ `Info.plist`. **Phải gọi trên main queue.**
    ///
    /// Idempotent bằng tay: `-[ZaloSDK initializeWithAppId:]` **không tự guard** - cờ
    /// `_initialized` chỉ được ghi ở cuối hàm, không có early-return - nên gọi hai lần sẽ
    /// chạy lại cả `initDeviceId` lẫn lượt nạp settings qua mạng.
    private func ensureInitialisedOnMain() {
        assert(Thread.isMainThread, "ensureInitialisedOnMain phải chạy trên main queue")
        if initialised { return }

        guard let appId = ZaloConfig.appIdFromInfoPlist else { return }

        let existing = ZaloSDK.sharedInstance()?.appId()
        if existing == nil || existing?.isEmpty == true {
            ZaloSDK.sharedInstance()?.initialize(withAppId: appId)
        }
        ZaloSDK.sharedInstance()?.setOauthDelegate(oauthDelegate)
        initialised = true
    }

    /// Gọi từ `__attribute__((constructor))` của `.mm`, tức lúc dyld nạp image.
    @objc public func bootstrap() {
        onMain { [self] in ensureInitialisedOnMain() }
    }

    // MARK: - Chuyển tiếp URL

    private static let urlHandledLock = NSLock()
    private static var didHandleAnyURL = false

    @objc public static func markURLHandled() {
        urlHandledLock.lock()
        didHandleAnyURL = true
        urlHandledLock.unlock()
    }

    @objc public static var hasEverHandledURL: Bool {
        urlHandledLock.lock()
        defer { urlHandledLock.unlock() }
        return didHandleAnyURL
    }

    // MARK: - login

    @objc public func login(
        optionsJSON: String,
        presenter: UIViewController?,
        resolve: @escaping Resolve,
        reject: @escaping Reject
    ) {
        let options = (try? JSONSerialization.jsonObject(with: Data(optionsJSON.utf8))) as? [String: Any] ?? [:]
        let via = (options["via"] as? String) ?? "app_or_web"
        let exchangeMode = (options["exchange"] as? String) ?? "device"
        let includeRefresh = (options["includeRefreshToken"] as? Bool) ?? false
        let timeoutMs = (options["timeoutMs"] as? Int) ?? PromiseGate.defaultTimeoutMs
        let extInfo = (options["extInfo"] as? [String: String]) ?? [:]

        onMain { [self] in
            ensureInitialisedOnMain()

            guard let appId = ZaloConfig.appIdFromInfoPlist else {
                var error = ErrorMapping.simple(
                    .invalidConfig, phase: .config,
                    message: "Thiếu khoá `ZaloAppID` trong Info.plist của ứng dụng."
                )
                error.nativeMessage = "Info.plist missing ZaloAppID"
                error.bundleId = Bundle.main.bundleIdentifier
                return reject(error.code.rawValue, error.humanMessage, error.asNSError)
            }
            _ = appId

            // Single-flight. `ZOZaloAuthenticator` chỉ giữ MỘT completion handler, nên lần
            // gọi thứ hai sẽ ghi đè lần thứ nhất và gate cũ chỉ chết bằng timeout.
            stateLock.lock()
            if let existing = loginGate, !existing.isSettled {
                stateLock.unlock()
                let error = ErrorMapping.simple(.loginInProgress, phase: .authorize)
                return reject(error.code.rawValue, error.humanMessage, error.asNSError)
            }

            guard let pkce = PKCE.generate() else {
                stateLock.unlock()
                let error = ErrorMapping.simple(
                    .unknown, phase: .authorize, message: "Không sinh được mã bảo mật PKCE."
                )
                return reject(error.code.rawValue, error.humanMessage, error.asNSError)
            }

            let attemptId = UUID().uuidString
            var gateRef: PromiseGate?
            let gate = PromiseGate(
                resolve: resolve, reject: reject, timeoutMs: timeoutMs, phase: .authorize,
                // Hết giờ MÀ đủ ba tiền đề của `looksUnwired` thì nguyên nhân không phải
                // "mạng chậm" - là app quên chuyển tiếp URL callback. Báo đúng tên nguyên
                // nhân, kèm chỉ dẫn, thay vì để người ta đi tìm lỗi mạng.
                timeoutCode: { RnZaloToolkitURLTracking.looksUnwired ? .notWired : .timeout }
            ) { [weak self] in
                guard let self, let settledGate = gateRef else { return }
                self.clearLoginState(ifCurrent: settledGate)
            }
            gateRef = gate
            loginGate = gate
            currentAttemptId = attemptId
            stateLock.unlock()

            guard let parent = presenter ?? Self.fallbackPresenter() else {
                // `-[ZOZaloAuthenticator authenticateZaloWithAuthenType:parentController:...]`
                // chỉ lưu tham số, KHÔNG kiểm nil. Present lên nil là no-op im lặng và
                // handler không bao giờ chạy - đúng cái hang thư viện này sinh ra để dẹp.
                gate.fail(ErrorMapping.simple(
                    .unknown, phase: .authorize,
                    message: "Không tìm được màn hình để hiển thị đăng nhập Zalo."
                ))
                return
            }

            ZaloSDK.sharedInstance()?.authenticateZalo(
                with: Self.authenType(from: via),
                parentController: parent,
                codeChallenge: pkce.challenge,
                extInfo: extInfo
            ) { [weak self] response in
                self?.handleOAuthResponse(
                    response, gate: gate, attemptId: attemptId, verifier: pkce.verifier,
                    exchangeMode: exchangeMode, includeRefresh: includeRefresh
                )
            }
        }
    }

    private func handleOAuthResponse(
        _ response: ZOOauthResponseObject?,
        gate: PromiseGate,
        attemptId: String,
        verifier: String,
        exchangeMode: String,
        includeRefresh: Bool
    ) {
        guard let response else {
            gate.fail(ErrorMapping.simple(.unknown, phase: .authorize))
            return
        }

        guard response.isSucess, let oauthCode = response.oauthCode, !oauthCode.isEmpty else {
            gate.fail(ErrorMapping.error(
                native: response.errorCode, nativeMessage: response.errorMessage, phase: .authorize
            ))
            return
        }

        // Chỉ emit khi gate còn sống VÀ đúng phiên - kết quả lạc của một phiên đã hết giờ
        // không được làm UI đổi nhãn.
        emitOauthCodeReceived(attemptId: attemptId, gate: gate)

        let channel = Self.channel(from: response.type)
        let isNewUser = response.isRegister

        if exchangeMode == "none" {
            gate.succeedJSON([
                "exchange": "none",
                "oauthCode": oauthCode,
                "codeVerifier": verifier,
                "channel": channel,
                "isNewUser": isNewUser,
            ], phase: .authorize)
            return
        }

        onMain {
            ZaloSDK.sharedInstance()?.getAccessToken(
                withOAuthCode: oauthCode, codeVerifier: verifier
            ) { [weak self] tokenResponse in
                guard let tokenResponse, tokenResponse.isSucess,
                      let accessToken = tokenResponse.accessToken, !accessToken.isEmpty
                else {
                    // Nhánh này rất dễ bị bỏ quên -
                    // promise treo vĩnh viễn và JS diễn giải nhầm thành "người dùng huỷ".
                    gate.fail(ErrorMapping.error(
                        native: tokenResponse?.errorCode ?? 0,
                        nativeMessage: tokenResponse?.errorMessage,
                        phase: .exchange
                    ))
                    return
                }

                self?.setSessionAccessToken(accessToken)

                var payload: [String: Any] = [
                    "exchange": "device",
                    "oauthCode": oauthCode,
                    "accessToken": accessToken,
                    "expiresAt": Int(tokenResponse.expriedTime * 1000),
                    "channel": channel,
                    "isNewUser": isNewUser,
                ]
                if includeRefresh, let refreshToken = tokenResponse.refreshToken {
                    payload["refreshToken"] = refreshToken
                }
                gate.succeedJSON(payload, phase: .exchange)
            }
        }
    }

    private func emitOauthCodeReceived(attemptId: String, gate: PromiseGate) {
        stateLock.lock()
        let isCurrent = currentAttemptId == attemptId && loginGate === gate
        let block = emitBlock
        stateLock.unlock()
        guard isCurrent, !gate.isSettled, let block else { return }
        block(attemptId)
    }

    // MARK: - token

    @objc public func exchangeOAuthCode(
        oauthCode: String, codeVerifier: String,
        resolve: @escaping Resolve, reject: @escaping Reject
    ) {
        let gate = PromiseGate(resolve: resolve, reject: reject, timeoutMs: 60_000, phase: .exchange)
        onMain { [self] in
            ensureInitialisedOnMain()
            ZaloSDK.sharedInstance()?.getAccessToken(withOAuthCode: oauthCode, codeVerifier: codeVerifier) { response in
                self.resolveTokens(gate, response)
            }
        }
    }

    @objc public func refreshTokens(
        refreshToken: String, resolve: @escaping Resolve, reject: @escaping Reject
    ) {
        let gate = PromiseGate(resolve: resolve, reject: reject, timeoutMs: 60_000, phase: .exchange)
        onMain { [self] in
            ensureInitialisedOnMain()
            ZaloSDK.sharedInstance()?.getAccessToken(withRefreshToken: refreshToken) { response in
                self.resolveTokens(gate, response)
            }
        }
    }

    private func resolveTokens(_ gate: PromiseGate, _ response: ZOTokenResponseObject?) {
        guard let response, response.isSucess, let accessToken = response.accessToken,
              !accessToken.isEmpty
        else {
            gate.fail(ErrorMapping.error(
                native: response?.errorCode ?? 0,
                nativeMessage: response?.errorMessage,
                phase: .exchange
            ))
            return
        }
        setSessionAccessToken(accessToken)
        gate.succeedJSON([
            "accessToken": accessToken,
            "refreshToken": response.refreshToken ?? "",
            "expiresAt": Int(response.expriedTime * 1000),
        ], phase: .exchange)
    }

    /// Không bao giờ reject - trả lời một câu hỏi boolean thì không được bắt người gọi
    /// viết `try/catch`. Kể cả hết giờ cũng resolve `false`.
    @objc public func isRefreshTokenValid(
        refreshToken: String, resolve: @escaping Resolve, reject: @escaping Reject
    ) {
        guard !refreshToken.isEmpty else { return resolve(false) }

        let settled = NSLock()
        var done = false
        let finish: (Bool) -> Void = { value in
            settled.lock()
            let alreadyDone = done
            done = true
            settled.unlock()
            if !alreadyDone { resolve(value) }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(30)) { finish(false) }

        onMain { [self] in
            ensureInitialisedOnMain()
            ZaloSDK.sharedInstance()?.validateRefreshToken(refreshToken, extInfo: [:]) { response in
                finish(response?.isSucess ?? false)
            }
        }
    }

    @objc public func logout(resolve: @escaping Resolve, reject: @escaping Reject) {
        // `unauthenticate` là đồng bộ (`ZDK.h` khai trả `void`) nên không có callback để chờ.
        // Nhưng nó vẫn phải chạy trên main queue: chính dòng này là thứ gây crash Hermes
        // khi chạy sai queue.
        onMain { [self] in
            // Huỷ phiên login đang dở TRƯỚC khi xoá token: nếu không, bước đổi token của
            // phiên đó có thể về sau `logout()` và ghi lại `sessionAccessToken`.
            stateLock.lock()
            let gate = loginGate
            stateLock.unlock()
            gate?.fail(ErrorMapping.simple(
                .cancelled, phase: .authorize, message: "Đăng xuất trong lúc đang đăng nhập."
            ))

            ZaloSDK.sharedInstance()?.unauthenticate()
            setSessionAccessToken(nil)
            resolve(nil)
        }
    }

    // MARK: - profile

    @objc public func getProfile(
        optsJSON: String, resolve: @escaping Resolve, reject: @escaping Reject
    ) {
        let opts = (try? JSONSerialization.jsonObject(with: Data(optsJSON.utf8))) as? [String: Any] ?? [:]
        let explicitToken = opts["accessToken"] as? String
        let token = explicitToken ?? currentSessionAccessToken()

        guard let token, !token.isEmpty else {
            let error = ErrorMapping.simple(
                .invalidToken, phase: .profile,
                message: "Chưa có phiên Zalo trong lần chạy này - hãy đăng nhập trước hoặc truyền accessToken."
            )
            return reject(error.code.rawValue, error.humanMessage, error.asNSError)
        }

        // `fields` cố ý bị bỏ qua trên iOS: SDK chỉ có
        // `getZaloUserProfileWithAccessToken:callback:`, không nhận danh sách field.
        // Ta lọc ở phía ta để hai nền tảng trả cùng một tập dữ liệu.
        let requestedFields = (opts["fields"] as? [String])

        let gate = PromiseGate(resolve: resolve, reject: reject, timeoutMs: 30_000, phase: .profile)
        onMain { [self] in
            ensureInitialisedOnMain()
            ZaloSDK.sharedInstance()?.getZaloUserProfile(withAccessToken: token) { response in
                guard let response else {
                    gate.fail(ErrorMapping.simple(.unknown, phase: .profile))
                    return
                }
                guard response.errorCode == 0, let data = response.data as? [String: Any] else {
                    gate.fail(ErrorMapping.error(
                        native: response.errorCode, nativeMessage: response.errorMessage, phase: .profile
                    ))
                    return
                }
                gate.succeedJSON(
                    Self.profilePayload(from: data, fields: requestedFields), phase: .profile
                )
            }
        }
    }

    // MARK: - chẩn đoán

    @objc public func verifyInstallation(resolve: @escaping Resolve, reject: @escaping Reject) {
        onMain { [self] in
            ensureInitialisedOnMain()
            guard let json = JSONPayload.string(InstallCheck.report()) else {
                let error = ErrorMapping.simple(.unknown, phase: .config)
                return reject(error.code.rawValue, error.humanMessage, error.asNSError)
            }
            resolve(json)
        }
    }

    /// iOS không có khái niệm hash key chữ ký như Android - trả `nil` thay vì ném, để người
    /// gọi dùng được vô điều kiện.
    @objc public func getApplicationHashKey(resolve: @escaping Resolve, reject: @escaping Reject) {
        resolve(nil)
    }

    @objc public func getSdkVersion(
        toolkitVersion: String, resolve: @escaping Resolve, reject: @escaping Reject
    ) {
        onMain {
            let native = ZaloSDK.sharedInstance()?.getVersion() ?? "unknown"
            guard let json = JSONPayload.string(["toolkit": toolkitVersion, "native": native]) else {
                return resolve("{\"toolkit\":\"unknown\",\"native\":\"unknown\"}")
            }
            resolve(json)
        }
    }

    // MARK: - trợ giúp

    /// Chỉ xoá state khi gate truyền vào ĐÚNG là gate hiện tại.
    ///
    /// Xoá vô điều kiện tạo một cửa sổ đua: gate1 hết giờ, `login()` #2 chen vào gán
    /// `loginGate = gate2`, rồi `cleanup()` của gate1 mới chạy và xoá mất gate2.
    private func clearLoginState(ifCurrent gate: PromiseGate) {
        stateLock.lock()
        if loginGate === gate {
            loginGate = nil
            currentAttemptId = nil
        }
        stateLock.unlock()
    }

    private func setSessionAccessToken(_ token: String?) {
        stateLock.lock()
        sessionAccessToken = token
        stateLock.unlock()
    }

    private func currentSessionAccessToken() -> String? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return sessionAccessToken
    }

    private static func authenType(from via: String) -> ZAZaloSDKAuthenType {
        switch via {
        case "app": return ZAZaloSDKAuthenTypeViaZaloAppOnly
        case "web": return ZAZaloSDKAuthenTypeViaWebViewOnly
        default: return ZAZAloSDKAuthenTypeViaZaloAppAndWebView
        }
    }

    private static func channel(from type: ZOLoginType) -> String {
        switch type {
        case .zalo: return "zalo"
        case .guest: return "guest"
        case .facebook: return "facebook"
        case .googlePlus: return "google"
        case .zingMe: return "zingme"
        default: return "unknown"
        }
    }

    private static func profilePayload(from data: [String: Any], fields: [String]?) -> [String: Any] {
        // SDK iOS không nhận danh sách field, nên lọc ở đây để app xin ít dữ liệu thì thật
        // sự nhận ít - kể cả trong `raw`. Không lọc thì `fields` là tuỳ chọn chỉ chạy trên
        // Android, và app giảm thiểu dữ liệu sẽ bị lộ PII trên iOS mà không có lỗi nào.
        let allowed = fields.map(Set.init)
        let filtered: [String: Any] = allowed.map { keys in
            data.filter { keys.contains($0.key) }
        } ?? data

        let pictureURL = ((filtered["picture"] as? [String: Any])?["data"] as? [String: Any])?["url"] as? String

        // Dùng NSNull chứ không bỏ khoá: kiểu công khai khai `string | null`, và một khoá
        // vắng mặt sẽ thành `undefined` ở JS - `profile.name === null` sẽ luôn sai.
        // `?? NSNull()` không biên dịch được vì hai vế khác kiểu; bọc qua `Any` tường minh.
        func orNull(_ value: String?) -> Any { value ?? NSNull() }

        return [
            "id": (filtered["id"] as? String) ?? "",
            "name": orNull(filtered["name"] as? String),
            "picture": ["url": orNull(pictureURL)],
            "birthday": orNull(filtered["birthday"] as? String),
            "gender": orNull(filtered["gender"] as? String),
            "phoneNumber": orNull(filtered["phoneNumber"] as? String),
            "raw": filtered,
        ]
    }

    /// Lưới cuối khi `.mm` không đưa được view controller nào.
    ///
    /// TUYỆT ĐỐI không dùng `UIApplication.shared.keyWindow`: deprecated từ iOS 13 và sai
    /// hẳn với app có nhiều scene - một app tiêu thụ có scene CarPlay, thứ không phải
    /// `UIWindowScene`.
    private static func fallbackPresenter() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let active = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        var controller = active?.windows.first { $0.isKeyWindow }?.rootViewController
            ?? active?.windows.first?.rootViewController
        while let presented = controller?.presentedViewController, !presented.isBeingDismissed {
            controller = presented
        }
        return controller
    }
}

/// Bản iOS của việc "không để SDK tự dựng dialog".
///
/// Mặc định của SDK là TRUE cho cả hai alert (`ZOZaloApiDelegate.h`), tức nó sẽ tự bật hộp
/// thoại mời cài/cập nhật Zalo mà app không kiểm soát được, còn `PromiseGate` thì đứng ngoài.
/// Trả `false` để app tự quyết hiển thị gì - giống hệt cách bản Android override
/// `onZaloNotInstalled` / `onZaloOutOfDate`.
private final class ZaloOAuthDelegate: NSObject, ZOZaloApiDelegate {
    func zaloSDKShouldBeginShowingDefaultZaloDownloadingAlertView() -> Bool { false }
    func zaloSDKShouldBeginShowingDefaultZaloUpdatingAlertView() -> Bool { false }

    /// Tiền đề (a) của cơ chế `NOT_WIRED`: chỉ khi SDK báo sắp rời app thì việc "không thấy
    /// URL callback nào" mới có ý nghĩa. Hai luồng còn lại (`WKWebView` trong app và
    /// `SFAuthenticationSession`) không hề sinh `openURL`.
    func zaloSDKWillLeaveApplication() {
        RnZaloToolkitURLTracking.markWillLeaveApplication()
    }
}

/// Theo dõi các tiền đề của `NOT_WIRED`.
public enum RnZaloToolkitURLTracking {
    private static let lock = NSLock()
    private static var willLeave = false
    private static var didReturn = false

    private static var observer: NSObjectProtocol?

    public static func markWillLeaveApplication() {
        lock.lock()
        willLeave = true
        // Đăng ký ĐÚNG MỘT LẦN. `zaloSDKWillLeaveApplication` fire mỗi lần đăng nhập qua
        // app Zalo, nên đăng ký vô điều kiện ở đây là rò observer không giới hạn trong một
        // singleton - cho một đường chỉ phục vụ chẩn đoán.
        let needsObserver = observer == nil
        lock.unlock()

        guard needsObserver else { return }
        let token = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil
        ) { _ in
            lock.lock()
            didReturn = true
            lock.unlock()
        }
        lock.lock()
        if observer == nil { observer = token } else { NotificationCenter.default.removeObserver(token) }
        lock.unlock()
    }

    /// ĐỦ ba tiền đề: SDK đã báo rời app, app đã quay lại, và chưa từng thấy URL nào được
    /// chuyển tiếp. Thiếu bất kỳ cái nào thì không được kết luận.
    public static var looksUnwired: Bool {
        lock.lock()
        let left = willLeave
        let returned = didReturn
        lock.unlock()
        return left && returned && !RnZaloToolkitCore.hasEverHandledURL
    }

    public static func reset() {
        lock.lock()
        willLeave = false
        didReturn = false
        lock.unlock()
    }
}
