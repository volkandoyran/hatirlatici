import Foundation

/// DNS mesajları için küçük yardımcılar.
enum DNSMessage {
    static func id(_ message: Data) -> UInt16? {
        let b = [UInt8](message.prefix(2))
        guard b.count == 2 else { return nil }
        return UInt16(b[0]) << 8 | UInt16(b[1])
    }

    /// Sorgudaki tek "question" bölümünün bittiği konum.
    private static func questionEnd(_ b: [UInt8]) -> Int? {
        guard b.count >= 12, b[4] == 0, b[5] == 1 else { return nil } // QDCOUNT == 1
        var i = 12
        while true {
            guard i < b.count else { return nil }
            let len = Int(b[i])
            if len == 0 { i += 1; break }
            if len & 0xC0 == 0xC0 { i += 2; break }
            i += 1 + len
        }
        i += 4 // QTYPE + QCLASS
        return i <= b.count ? i : nil
    }

    /// Hiçbir sunucu cevap vermezse istemciye hemen SERVFAIL döndürülür.
    static func servfail(for query: Data) -> Data? {
        let q = [UInt8](query)
        guard let end = questionEnd(q) else { return nil }
        var r = Array(q[0..<end])
        r[2] = 0x80 | (q[2] & 0x79)   // QR=1, opcode ve RD korunur
        r[3] = 0x80 | 0x02            // RA=1, RCODE=2 (SERVFAIL)
        r[6] = 0; r[7] = 0; r[8] = 0; r[9] = 0; r[10] = 0; r[11] = 0
        return Data(r)
    }

    /// Cevap tünelin taşıyabileceğinden büyükse, TC (kesildi) bayraklı kısa cevap üretilir.
    static func truncated(response: Data, query: Data) -> Data? {
        let q = [UInt8](query)
        let resp = [UInt8](response.prefix(12))
        guard resp.count == 12, let end = questionEnd(q) else { return nil }
        var r = resp + Array(q[12..<end])
        r[2] |= 0x02                  // TC=1
        r[4] = 0; r[5] = 1
        r[6] = 0; r[7] = 0; r[8] = 0; r[9] = 0; r[10] = 0; r[11] = 0
        return Data(r)
    }
}
