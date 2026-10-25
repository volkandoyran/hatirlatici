import Capacitor
import Foundation
import WidgetKit

// App Group kimliği WidgetKit hedefindeki kimlikle eşleşmelidir.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "syncReminders", returnType: CAPPluginReturnPromise)
    ]

    private let appGroupIdentifier = "group.com.hatirlaticilarim.app"
    private let remindersKey = "widget-reminders-v1"

    @objc public func syncReminders(_ call: CAPPluginCall) {
        guard let reminders = call.getArray("reminders", [JSObject].self) else {
            call.reject("Hatırlatma listesi okunamadı.")
            return
        }

        guard let sharedDefaults = UserDefaults(suiteName: appGroupIdentifier) else {
            call.reject("App Group deposu açılamadı. Uygulama ve widget imzalama ayarlarını kontrol edin.")
            return
        }

        do {
            // Widget için gerekli kayıt alanlarını ortak depoya yazar.
            let data = try JSONSerialization.data(withJSONObject: reminders)
            sharedDefaults.set(data, forKey: remindersKey)
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        } catch {
            call.reject("Widget verisi kaydedilemedi.", nil, error)
        }
    }
}
