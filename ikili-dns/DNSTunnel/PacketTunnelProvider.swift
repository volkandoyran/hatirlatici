import NetworkExtension

/// Sadece DNS trafiğini yakalayan "VPN". Diğer tüm trafik normal şekilde (Wi‑Fi veya hücresel) akar.
class PacketTunnelProvider: NEPacketTunnelProvider {
    private let resolver = DualResolver()
    private let dnsIP: [UInt8] = [198, 18, 0, 1]
    private let mtu = 1500
    private var running = false

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "127.0.0.1")

        let ipv4 = NEIPv4Settings(addresses: [DNSConfig.tunnelLocalAddress], subnetMasks: ["255.255.255.255"])
        // Tünele yalnızca sanal DNS sunucusunun adresi yönlendirilir
        ipv4.includedRoutes = [NEIPv4Route(destinationAddress: DNSConfig.tunnelDNSAddress, subnetMask: "255.255.255.255")]
        settings.ipv4Settings = ipv4

        let dns = NEDNSSettings(servers: [DNSConfig.tunnelDNSAddress])
        dns.matchDomains = [""] // Bütün alan adları için bu DNS'i kullan
        settings.dnsSettings = dns
        settings.mtu = NSNumber(value: mtu)

        setTunnelNetworkSettings(settings) { [weak self] error in
            if let error {
                completionHandler(error)
                return
            }
            self?.running = true
            self?.readPackets()
            completionHandler(nil)
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        running = false
        completionHandler()
    }

    /// Uygulama istatistik istediğinde çağrılır.
    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        completionHandler?(resolver.statsJSON())
    }

    private func readPackets() {
        packetFlow.readPackets { [weak self] packets, protocols in
            guard let self, self.running else { return }
            for (i, packet) in packets.enumerated() where protocols[i].int32Value == AF_INET {
                self.handle(packet)
            }
            self.readPackets()
        }
    }

    private func handle(_ packet: Data) {
        guard let dgram = IPv4UDP.parse(packet),
              dgram.dstPort == 53,
              dgram.dstIP == dnsIP else { return }
        let query = dgram.payload
        let maxPayload = mtu - 28

        resolver.resolve(query) { [weak self] response in
            guard let self else { return }
            var answer = response ?? DNSMessage.servfail(for: query)
            if let a = answer, a.count > maxPayload {
                answer = DNSMessage.truncated(response: a, query: query)
            }
            guard let payload = answer else { return }
            let out = IPv4UDP.build(srcIP: dgram.dstIP, dstIP: dgram.srcIP,
                                    srcPort: 53, dstPort: dgram.srcPort, payload: payload)
            self.packetFlow.writePackets([out], withProtocols: [NSNumber(value: AF_INET)])
        }
    }
}
