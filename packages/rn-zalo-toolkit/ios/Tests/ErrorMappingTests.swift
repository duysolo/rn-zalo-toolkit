import XCTest
@testable import RnZaloToolkit

/// Đối chiếu `ErrorMapping.swift` với `src/errorTable.json` - NGUỒN DUY NHẤT dùng chung cho
/// TypeScript, Kotlin và Swift.
///
/// Bản Android tương ứng: `android/src/test/kotlin/com/rnzalotoolkit/ErrorMappingTest.kt`.
/// Hai bài test này phải cùng đỏ khi bảng nguồn đổi mà một phía quên cập nhật - đó là toàn
/// bộ lý do chúng tồn tại.
final class ErrorMappingTests: XCTestCase {

    private struct Row: Decodable {
        let native: Int
        let platform: String
        let symbol: String
        let code: String
        let phase: String
    }

    private struct Table: Decodable {
        let codes: [Row]
    }

    private func loadRows() throws -> [Row] {
        // Đường dẫn tương đối từ thư mục test tới nguồn duy nhất.
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // ios/Tests
            .deletingLastPathComponent()   // ios
            .deletingLastPathComponent()   // packages/rn-zalo-toolkit
            .appendingPathComponent("src/errorTable.json")
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(Table.self, from: data).codes
    }

    private func iosRows() throws -> [Row] {
        try loadRows().filter { $0.platform == "ios" || $0.platform == "both" }
    }

    func testEveryIOSRowMapsAsDeclared() throws {
        var mismatches: [String] = []
        for row in try iosRows() {
            guard let phase = ZaloErrorPhase(rawValue: row.phase) else {
                mismatches.append("phase không hợp lệ: \(row.phase)")
                continue
            }
            let actual = ErrorMapping.code(forNative: row.native, phase: phase).rawValue
            if actual != row.code {
                mismatches.append("native=\(row.native) (\(row.symbol)) mong đợi \(row.code), nhận \(actual)")
            }
        }
        XCTAssertEqual(mismatches, [], "Lệch giữa errorTable.json và ErrorMapping.swift")
    }

    /// Bài test quan trọng nhất của file.
    ///
    /// `-7014` và `-7015` mang nghĩa HOÀN TOÀN khác nhau giữa hai nền tảng. Nếu ai đó gộp hai
    /// bảng làm một, người dùng iOS bị giới hạn tần suất sẽ nhận thông báo "Zalo bản cũ" và
    /// đi cập nhật ứng dụng một cách vô ích.
    func testCollidingCodesKeepIOSMeaning() throws {
        XCTAssertEqual(ErrorMapping.code(forNative: -7014, phase: .authorize), .unknown)
        XCTAssertEqual(ErrorMapping.code(forNative: -7015, phase: .authorize), .rateLimited)

        XCTAssertNotEqual(ErrorMapping.code(forNative: -7014, phase: .authorize), .zaloNotInstalled)
        XCTAssertNotEqual(ErrorMapping.code(forNative: -7015, phase: .authorize), .zaloOutOfDate)

        // Trên iOS, "chưa cài" và "bản cũ" nằm ở hai mã KHÁC.
        XCTAssertEqual(ErrorMapping.code(forNative: -7023, phase: .authorize), .zaloNotInstalled)
        XCTAssertEqual(ErrorMapping.code(forNative: -7022, phase: .authorize), .zaloOutOfDate)
    }

    /// Tập mã huỷ của iOS là tập MỞ: `-1001` không hề có trong `ZDKZaloError.h` nhưng demo
    /// chính hãng lại dùng chính nó làm mốc "không phải cancel".
    func testAllIOSCancelCodes() {
        for native in [-7021, -7035, -1011, -1005, -1001, -6003] {
            XCTAssertEqual(
                ErrorMapping.code(forNative: native, phase: .authorize),
                .cancelled,
                "native=\(native) phải là huỷ - rơi vào UNKNOWN nghĩa là nút Huỷ sẽ bung alert lỗi"
            )
        }
    }

    func testUnknownFallsBackByPhase() {
        XCTAssertEqual(ErrorMapping.code(forNative: -999_999, phase: .authorize), .unknown)
        XCTAssertEqual(ErrorMapping.code(forNative: -999_999, phase: .exchange), .tokenExchangeFailed)
    }

    func testOutsideVietnamIsProfileRestricted() {
        XCTAssertEqual(ErrorMapping.code(forNative: -501, phase: .profile), .profileRestricted)
    }

    /// Thông điệp được app tiêu thụ bung thẳng ra alert cho người dùng cuối, nên nó phải là
    /// câu đọc được - không phải JSON, không phải tên hằng số.
    func testHumanMessagesAreReadable() {
        let allCodes: [ZaloErrorCode] = [
            .cancelled, .loginInProgress, .zaloNotInstalled, .zaloOutOfDate, .invalidConfig,
            .notWired, .network, .timeout, .tokenExchangeFailed, .invalidToken,
            .profileRestricted, .rateLimited, .unknown,
        ]
        for code in allCodes {
            let message = ErrorMapping.humanMessage(for: code)
            XCTAssertFalse(message.isEmpty, "\(code) thiếu thông điệp")
            XCTAssertFalse(message.contains("{"), "\(code) lọt JSON vào thông điệp hiển thị")
            XCTAssertFalse(message.contains(code.rawValue), "\(code) lọt tên mã vào thông điệp")
        }
    }

    /// Chi tiết máy đọc đi qua `userInfo["details"]`, KHÔNG qua `message`.
    func testDetailsCarryContextWithoutSecrets() throws {
        var error = ZaloToolkitError(
            code: .invalidConfig,
            phase: .config,
            humanMessage: "Cấu hình Zalo chưa đúng."
        )
        error.nativeCode = -5005
        error.nativeMessage = "invalid ios bundle id"
        error.bundleId = "vn.estations.app"

        let json = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(error.detailsJSON.utf8)) as? [String: Any]
        )
        XCTAssertEqual(json["phase"] as? String, "config")
        XCTAssertEqual(json["nativeCode"] as? Int, -5005)
        XCTAssertEqual(json["bundleId"] as? String, "vn.estations.app")

        let serialised = error.detailsJSON + error.humanMessage
        for secret in ["SECRET_ACCESS_TOKEN", "SECRET_REFRESH", "SECRET_VERIFIER"] {
            XCTAssertFalse(serialised.contains(secret), "Rò bí mật vào lỗi")
        }
    }
}
