import Foundation
import NetworkExtension

@MainActor
final class VPNManager: ObservableObject {
    @Published private(set) var status: NEVPNStatus = .invalid
    @Published private(set) var stats = TunnelStats()
    @Published var errorMessage: String?

    private var manager: NETunnelProviderManager?
    private var statsTimer: Timer?

    init() {
        NotificationCenter.default.addObserver(forName: .NEVPNStatusDidChange, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refreshStatus() }
        }
        Task { await load() }
    }

    var isOn: Bool { status == .connected || status == .connecting || status == .reasserting }

    func load() async {
        do {
            manager = try await NETunnelProviderManager.loadAllFromPreferences().first
            refreshStatus()
        } catch {
            errorMessage = "Ayarlar okunamadı: \(error.localizedDescription)"
        }
    }

    func connect() async {
        errorMessage = nil
        do {
            let m = manager ?? NETunnelProviderManager()
            let proto = NETunnelProviderProtocol()
            proto.providerBundleIdentifier = (Bundle.main.bundleIdentifier ?? "") + ".tunnel"
            proto.serverAddress = "Google + AdGuard DNS"
            m.protocolConfiguration = proto
            m.localizedDescription = "İkili DNS"
            m.isEnabled = true

            // Her ağda (Wi‑Fi ve hücresel) otomatik açık kalsın
            let rule = NEOnDemandRuleConnect()
            rule.interfaceTypeMatch = .any
            m.onDemandRules = [rule]
            m.isOnDemandEnabled = true

            try await m.saveToPreferences()
            try await m.loadFromPreferences()
            manager = m
            try m.connection.startVPNTunnel()
        } catch {
            errorMessage = "Başlatılamadı: \(error.localizedDescription)"
        }
    }

    func disconnect() async {
        guard let m = manager else { return }
        // Önce "isteğe bağlı bağlan" kapatılmalı, yoksa iOS hemen yeniden açar
        m.isOnDemandEnabled = false
        do { try await m.saveToPreferences() } catch {
            errorMessage = "Kapatılamadı: \(error.localizedDescription)"
        }
        m.connection.stopVPNTunnel()
    }

    private func refreshStatus() {
        status = manager?.connection.status ?? .invalid
        if status == .connected {
            if statsTimer == nil {
                statsTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
                    Task { @MainActor in self?.pollStats() }
                }
                pollStats()
            }
        } else {
            statsTimer?.invalidate()
            statsTimer = nil
        }
    }

    private func pollStats() {
        guard let session = manager?.connection as? NETunnelProviderSession else { return }
        try? session.sendProviderMessage(Data("stats".utf8)) { [weak self] data in
            guard let data, let s = try? JSONDecoder().decode(TunnelStats.self, from: data) else { return }
            Task { @MainActor in self?.stats = s }
        }
    }
}
