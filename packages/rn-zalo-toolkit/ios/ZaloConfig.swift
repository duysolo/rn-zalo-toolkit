import CryptoKit
import Foundation

/// Đọc cấu hình từ `Info.plist` của app. Không có state nào được ghi xuống đĩa.
enum ZaloConfig {
    static let infoPlistAppIdKey = "ZaloAppID"

    static var appIdFromInfoPlist: String? {
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: infoPlistAppIdKey) as? String,
            !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Scheme mà Zalo gọi ngược về app: `zalo-<appId>`.
    static func expectedURLScheme(appId: String) -> String { "zalo-\(appId)" }

    /// Các scheme app phải khai trong `LSApplicationQueriesSchemes` để mở được app Zalo.
    static let requiredQueriesSchemes = ["zalosdk", "zaloshareext"]

    /// Mọi scheme khai trong `CFBundleURLTypes`.
    static var declaredURLSchemes: [String] {
        guard let types = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]]
        else { return [] }
        return types.flatMap { ($0["CFBundleURLSchemes"] as? [String]) ?? [] }
    }

    static var declaredQueriesSchemes: [String] {
        (Bundle.main.object(forInfoDictionaryKey: "LSApplicationQueriesSchemes") as? [String]) ?? []
    }
}

/// Sinh PKCE theo RFC 7636, `method=S256`.
///
/// SDK Zalo KHÔNG sinh hộ: `authenticateZaloWithAuthenType:...` nhận `codeChallenge` từ
/// người gọi, và `getAccessTokenWithOAuthCode:codeVerifier:` đòi lại `codeVerifier`. Nghĩa là
/// việc này thuộc về thư viện, và công thức phải được chốt ở một chỗ chứ không để mỗi nền
/// tảng tự chế.
///
/// `codeVerifier` = 32 byte CSPRNG → base64url không padding = **đúng 43 ký tự**, tức cận
/// dưới của RFC (43-128). `codeChallenge` = base64url(SHA-256(ASCII bytes của verifier)).
enum PKCE {
    struct Pair {
        let verifier: String
        let challenge: String
    }

    static func generate() -> Pair? {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            return nil
        }
        let verifier = base64URLNoPadding(Data(bytes))
        guard let verifierData = verifier.data(using: .ascii) else { return nil }
        let challenge = base64URLNoPadding(Data(SHA256.hash(data: verifierData)))
        return Pair(verifier: verifier, challenge: challenge)
    }

    static func base64URLNoPadding(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
