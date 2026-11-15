import SwiftUI

@main
struct IkiliDNSApp: App {
    @StateObject private var vpn = VPNManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(vpn)
        }
    }
}
