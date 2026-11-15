import Foundation
import Network

/// Her DNS sorgusunu Google ve AdGuard'a aynı anda gönderir, ilk gelen geçerli cevabı döndürür.
final class DualResolver {
    private let queue = DispatchQueue(label: "ikilidns.resolver")
    private var active: [ObjectIdentifier: QueryRace] = [:]
    private var stats = TunnelStats()

    func resolve(_ query: Data, completion: @escaping (Data?) -> Void) {
        queue.async {
            guard let qid = DNSMessage.id(query) else { completion(nil); return }
            let race = QueryRace(query: query, queryID: qid, queue: self.queue)
            let key = ObjectIdentifier(race)
            self.active[key] = race
            race.start { [weak self] response, winner, latencyMs in
                guard let self else { return }
                self.active[key] = nil
                self.stats.total += 1
                if let winner {
                    self.stats.answeredBy[winner, default: 0] += 1
                    self.stats.lastLatencyMs[winner] = latencyMs
                } else {
                    self.stats.failed += 1
                }
                completion(response)
            }
        }
    }

    func statsJSON() -> Data? {
        queue.sync { try? JSONEncoder().encode(stats) }
    }
}

/// Tek bir sorgunun sunucular arasındaki yarışı. Tüm işlemler aynı seri kuyrukta çalışır.
private final class QueryRace {
    private let query: Data
    private let queryID: UInt16
    private let queue: DispatchQueue
    private var connections: [NWConnection] = []
    private var finished = false
    private var onFinish: ((Data?, String?, Int) -> Void)?
    private let startTime = DispatchTime.now()

    init(query: Data, queryID: UInt16, queue: DispatchQueue) {
        self.query = query
        self.queryID = queryID
        self.queue = queue
    }

    func start(_ onFinish: @escaping (Data?, String?, Int) -> Void) {
        self.onFinish = onFinish
        // 1) İki sağlayıcının birincil sunucularına aynı anda gönder
        for p in DNSConfig.providers { send(to: p.primary, provider: p.name) }
        // 2) Cevap gecikirse ikincil sunucuları da yarışa kat
        queue.asyncAfter(deadline: .now() + DNSConfig.secondaryDelay) { [weak self] in
            guard let self, !self.finished else { return }
            for p in DNSConfig.providers { self.send(to: p.secondary, provider: p.name) }
        }
        // 3) Zaman aşımı
        queue.asyncAfter(deadline: .now() + DNSConfig.queryTimeout) { [weak self] in
            self?.finish(nil, nil)
        }
    }

    private func send(to host: String, provider: String) {
        let conn = NWConnection(host: NWEndpoint.Host(host), port: 53, using: .udp)
        connections.append(conn)
        conn.stateUpdateHandler = { [weak self, weak conn] state in
            guard let self, let conn else { return }
            switch state {
            case .ready:
                conn.send(content: self.query, completion: .contentProcessed { _ in })
                self.receive(on: conn, provider: provider)
            case .failed:
                conn.cancel()
            default:
                break
            }
        }
        conn.start(queue: queue)
    }

    private func receive(on conn: NWConnection, provider: String) {
        conn.receiveMessage { [weak self, weak conn] data, _, _, error in
            guard let self, !self.finished else { return }
            if let data, data.count >= 12, DNSMessage.id(data) == self.queryID {
                self.finish(data, provider)
            } else if error == nil, let conn {
                self.receive(on: conn, provider: provider) // ID tutmadı, bekle
            }
        }
    }

    private func finish(_ response: Data?, _ provider: String?) {
        guard !finished else { return }
        finished = true
        for c in connections {
            c.stateUpdateHandler = nil
            c.cancel()
        }
        connections.removeAll()
        let ms = Int((DispatchTime.now().uptimeNanoseconds - startTime.uptimeNanoseconds) / 1_000_000)
        let callback = onFinish
        onFinish = nil
        callback?(response, provider, ms)
    }
}
