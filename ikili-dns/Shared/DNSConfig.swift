import Foundation

/// Sorguların gönderildiği bir DNS sağlayıcısı.
struct DNSProvider {
    let name: String
    let primary: String
    let secondary: String
}

enum DNSConfig {
    /// Her sorgu bu iki sağlayıcıya AYNI ANDA gönderilir; ilk gelen geçerli cevap kullanılır.
    static let providers: [DNSProvider] = [
        DNSProvider(name: "Google", primary: "8.8.8.8", secondary: "8.8.4.4"),
        // Reklam engelleyen AdGuard DNS. Filtresiz istiyorsanız: 94.140.14.140 / 94.140.14.141
        DNSProvider(name: "AdGuard", primary: "94.140.14.14", secondary: "94.140.15.15"),
    ]

    /// Tünel içindeki sanal DNS sunucusu (iOS bütün DNS sorgularını buraya yollar).
    static let tunnelDNSAddress = "198.18.0.1"
    static let tunnelLocalAddress = "198.18.0.2"

    /// Birincil sunuculardan bu süre içinde cevap gelmezse ikincil sunucular da denenir.
    static let secondaryDelay: TimeInterval = 1.0
    /// Hiç cevap gelmezse sorgu bu sürede başarısız sayılır.
    static let queryTimeout: TimeInterval = 4.0
}

/// Uzantıdan uygulamaya gönderilen istatistikler.
struct TunnelStats: Codable {
    var total: Int = 0
    var failed: Int = 0
    /// Sağlayıcı adı -> ilk cevabı o sağlayıcının verdiği sorgu sayısı
    var answeredBy: [String: Int] = [:]
    /// Sağlayıcı adı -> son kazandığı sorgunun süresi (ms)
    var lastLatencyMs: [String: Int] = [:]
}
