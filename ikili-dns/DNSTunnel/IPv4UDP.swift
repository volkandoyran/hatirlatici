import Foundation

struct UDPDatagram {
    let srcIP: [UInt8]
    let dstIP: [UInt8]
    let srcPort: UInt16
    let dstPort: UInt16
    let payload: Data
}

/// Tünelden okunan ham IPv4/UDP paketlerini çözer ve cevap paketleri oluşturur.
enum IPv4UDP {
    static func parse(_ packet: Data) -> UDPDatagram? {
        let b = [UInt8](packet)
        guard b.count >= 28, b[0] >> 4 == 4 else { return nil }
        let ihl = Int(b[0] & 0x0F) * 4
        guard ihl >= 20, b[9] == 17 else { return nil } // 17 = UDP
        // Parçalanmış (fragment) paketleri atla
        let flagsAndOffset = UInt16(b[6]) << 8 | UInt16(b[7])
        guard flagsAndOffset & 0x3FFF == 0 else { return nil }
        let totalLength = Int(UInt16(b[2]) << 8 | UInt16(b[3]))
        guard totalLength <= b.count, totalLength >= ihl + 8 else { return nil }
        let udpLength = Int(UInt16(b[ihl + 4]) << 8 | UInt16(b[ihl + 5]))
        guard udpLength >= 8, ihl + udpLength <= totalLength else { return nil }
        return UDPDatagram(
            srcIP: Array(b[12..<16]),
            dstIP: Array(b[16..<20]),
            srcPort: UInt16(b[ihl]) << 8 | UInt16(b[ihl + 1]),
            dstPort: UInt16(b[ihl + 2]) << 8 | UInt16(b[ihl + 3]),
            payload: Data(b[(ihl + 8)..<(ihl + udpLength)])
        )
    }

    static func build(srcIP: [UInt8], dstIP: [UInt8], srcPort: UInt16, dstPort: UInt16, payload: Data) -> Data {
        let udpLength = 8 + payload.count
        let totalLength = 20 + udpLength
        var h = [UInt8](repeating: 0, count: 28)
        h[0] = 0x45                       // IPv4, 20 bayt başlık
        h[2] = UInt8(totalLength >> 8)
        h[3] = UInt8(totalLength & 0xFF)
        h[6] = 0x40                       // Don't Fragment
        h[8] = 64                         // TTL
        h[9] = 17                         // UDP
        h.replaceSubrange(12..<16, with: srcIP)
        h.replaceSubrange(16..<20, with: dstIP)
        let sum = checksum(h[0..<20])
        h[10] = UInt8(sum >> 8)
        h[11] = UInt8(sum & 0xFF)
        h[20] = UInt8(srcPort >> 8)
        h[21] = UInt8(srcPort & 0xFF)
        h[22] = UInt8(dstPort >> 8)
        h[23] = UInt8(dstPort & 0xFF)
        h[24] = UInt8(udpLength >> 8)
        h[25] = UInt8(udpLength & 0xFF)
        // h[26..27] = 0 -> IPv4'te UDP checksum isteğe bağlıdır
        var out = Data(h)
        out.append(payload)
        return out
    }

    private static func checksum(_ bytes: ArraySlice<UInt8>) -> UInt16 {
        var sum: UInt32 = 0
        var i = bytes.startIndex
        while i + 1 < bytes.endIndex {
            sum += UInt32(bytes[i]) << 8 | UInt32(bytes[i + 1])
            i += 2
        }
        if i < bytes.endIndex { sum += UInt32(bytes[i]) << 8 }
        while sum >> 16 != 0 { sum = (sum & 0xFFFF) + (sum >> 16) }
        return ~UInt16(sum)
    }
}
