import SwiftUI
import NetworkExtension

struct ContentView: View {
    @EnvironmentObject private var vpn: VPNManager

    var body: some View {
        NavigationView {
            List {
                Section {
                    VStack(spacing: 16) {
                        Image(systemName: vpn.isOn ? "checkmark.shield.fill" : "shield.slash")
                            .font(.system(size: 64))
                            .foregroundColor(vpn.isOn ? .green : .secondary)
                        Text(statusText)
                            .font(.title2.bold())
                        Button {
                            Task {
                                if vpn.isOn { await vpn.disconnect() } else { await vpn.connect() }
                            }
                        } label: {
                            Text(vpn.isOn ? "Kapat" : "Aç")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(vpn.isOn ? .red : .accentColor)
                        if let err = vpn.errorMessage {
                            Text(err).font(.footnote).foregroundColor(.red)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical)
                }

                Section(header: Text("Aynı anda sorgulanan DNS'ler")) {
                    ForEach(DNSConfig.providers, id: \.name) { p in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(p.name).font(.headline)
                                Text("\(p.primary) · \(p.secondary)")
                                    .font(.caption).foregroundColor(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing) {
                                Text("\(vpn.stats.answeredBy[p.name] ?? 0) cevap")
                                if let ms = vpn.stats.lastLatencyMs[p.name] {
                                    Text("\(ms) ms").font(.caption).foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                }

                Section(header: Text("Özet"),
                        footer: Text("Her sorgu iki sağlayıcıya birden gider; hangisi önce cevap verirse o kullanılır. Biri çökerse diğeri devam eder. Wi‑Fi ve hücresel veride çalışır.")) {
                    LabeledRow(title: "Toplam sorgu", value: "\(vpn.stats.total)")
                    LabeledRow(title: "Başarısız", value: "\(vpn.stats.failed)")
                }
            }
            .navigationTitle("İkili DNS")
        }
    }

    private var statusText: String {
        switch vpn.status {
        case .connected: return "Açık"
        case .connecting: return "Bağlanıyor…"
        case .disconnecting: return "Kapanıyor…"
        case .reasserting: return "Yeniden bağlanıyor…"
        case .disconnected: return "Kapalı"
        case .invalid: return "Kurulmadı"
        @unknown default: return "Bilinmiyor"
        }
    }
}

private struct LabeledRow: View {
    let title: String
    let value: String
    var body: some View {
        HStack {
            Text(title)
            Spacer()
            Text(value).foregroundColor(.secondary)
        }
    }
}
