import Foundation

/// Bảo đảm MỘT promise settle đúng MỘT lần, trong mọi nhánh, và luôn có trần thời gian.
///
/// Đây là xương sống của cả thư viện. SDK Zalo không có cơ chế nào chống settle hai lần,
/// và tệ hơn: `-[ZaloSDK handleDidBecomeActive]` là no-op (kiểm bằng `otool -tV`: đúng một
/// lệnh `ret`), nghĩa là SDK **không đối soát gì khi app quay lại foreground**. Nếu người
/// dùng rời sang Zalo rồi không quyết gì, không ai khác phát hiện được - `timeout` ở đây
/// là lưới duy nhất.
///
/// KHOÁ: dùng `NSLock`, KHÔNG dùng `os_unfair_lock`. `os_unfair_lock` là struct C cấm sao
/// chép; gọi `os_unfair_lock_lock(&self.lock)` trên một stored property của Swift đi qua
/// chuyển đổi `inout` có thể sinh bản sao, và khi đó khoá mất tác dụng mà **không có lỗi
/// biên dịch**.
///
/// KHÔNG dùng `actor`: gate phải settle được ĐỒNG BỘ ngay bên trong completion block của SDK
/// trên thread bất kỳ. Một `await` hop sẽ mở đúng cửa sổ đua mà timeout có thể thắng, biến
/// tính xác định thành xác suất.
final class PromiseGate {
    typealias Resolve = (Any?) -> Void
    typealias Reject = (String?, String?, Error?) -> Void

    private let lock = NSLock()
    private var settled = false
    private var resolve: Resolve?
    private var reject: Reject?
    private var timeoutItem: DispatchWorkItem?
    private var onSettle: (() -> Void)?

    init(
        resolve: @escaping Resolve,
        reject: @escaping Reject,
        timeoutMs: Int,
        phase: ZaloErrorPhase,
        timeoutCode: (() -> ZaloErrorCode)? = nil,
        onSettle: (() -> Void)? = nil
    ) {
        self.resolve = resolve
        self.reject = reject
        self.onSettle = onSettle

        // `timeoutMs <= 0` sẽ tắt hẳn lưới an toàn và promise treo vĩnh viễn - đúng thứ thư
        // viện này tồn tại để dẹp. Kẹp về mặc định thay vì im lặng bỏ qua.
        let effectiveTimeout = timeoutMs > 0 ? timeoutMs : PromiseGate.defaultTimeoutMs

        // Capture MẠNH `self` là có chủ đích.
        //
        // `[weak self]` ở đây là một cái bẫy: gate của `exchangeOAuthCode`/`refreshTokens`/
        // `getProfile`/`isRefreshTokenValid` chỉ được completion block của SDK giữ. Nếu SDK
        // nhả handler mà không gọi (lỗi mạng, request bị huỷ), gate dealloc và timer fire
        // với `self == nil` ⇒ no-op ⇒ JS treo mãi mãi. Không có retain cycle: `claim()`/
        // `fail()` đều `cancel()` rồi gán `timeoutItem = nil`, và `DispatchQueue` nhả work
        // item sau deadline dù có chạy hay không.
        let item = DispatchWorkItem {
            let code = timeoutCode?() ?? .timeout
            self.fail(ErrorMapping.simple(code, phase: phase))
        }
        timeoutItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(effectiveTimeout), execute: item)
    }

    static let defaultTimeoutMs = 120_000

    /// `true` nếu chính lời gọi này là lời gọi đã settle - dùng để tránh làm việc thừa.
    @discardableResult
    func succeed(_ value: Any?) -> Bool {
        guard let resolve = claim() else { return false }
        resolve(value)
        return true
    }

    /// Settle bằng JSON string.
    ///
    /// Spec TurboModule khai `Promise<string>` cho mọi thứ có hình dạng tự do, và
    /// `src/index.ts` gọi `JSON.parse` trên kết quả. Resolve thẳng một `NSDictionary` sẽ
    /// khiến JSI trả về object, `JSON.parse(object)` ép sang `"[object Object]"` và ném -
    /// tức MỌI lời gọi trên iOS đều hỏng. Android đã đúng nhờ `JSONObject.toString()`;
    /// hàm này là bản tương ứng.
    @discardableResult
    func succeedJSON(_ payload: [String: Any], phase: ZaloErrorPhase) -> Bool {
        guard
            JSONSerialization.isValidJSONObject(payload),
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let json = String(data: data, encoding: .utf8)
        else {
            return fail(ErrorMapping.simple(
                .unknown, phase: phase,
                message: "Không dựng được dữ liệu trả về từ Zalo."
            ))
        }
        return succeed(json)
    }

    @discardableResult
    func fail(_ error: ZaloToolkitError) -> Bool {
        lock.lock()
        if settled {
            lock.unlock()
            return false
        }
        settled = true
        let rejectBlock = reject
        let cleanup = onSettle
        resolve = nil
        reject = nil
        onSettle = nil
        timeoutItem?.cancel()
        timeoutItem = nil
        lock.unlock()

        cleanup?()
        rejectBlock?(error.code.rawValue, error.humanMessage, error.asNSError)
        return true
    }

    var isSettled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return settled
    }

    private func claim() -> Resolve? {
        lock.lock()
        if settled {
            lock.unlock()
            return nil
        }
        settled = true
        let block = resolve
        let cleanup = onSettle
        resolve = nil
        reject = nil
        onSettle = nil
        timeoutItem?.cancel()
        timeoutItem = nil
        lock.unlock()

        cleanup?()
        return block
    }
}

/// Serialize một payload thành JSON string cho các đường KHÔNG đi qua gate.
enum JSONPayload {
    static func string(_ payload: [String: Any]) -> String? {
        guard
            JSONSerialization.isValidJSONObject(payload),
            let data = try? JSONSerialization.data(withJSONObject: payload)
        else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
