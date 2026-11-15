import SwiftUI
import WidgetKit

/// AltStore gibi yan yükleme araçları App Group kimliğini değiştirip `ALTAppGroups`
/// anahtarına yazar. Önce uzantının, sonra onu içeren uygulamanın Info.plist'ine bakılır.
private let widgetAppGroupIdentifier: String = {
    let anahtar = "ALTAppGroups"
    if let gruplar = Bundle.main.object(forInfoDictionaryKey: anahtar) as? [String], let ilk = gruplar.first {
        return ilk
    }
    let uygulamaURL = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
    if let uygulama = Bundle(url: uygulamaURL),
       let gruplar = uygulama.object(forInfoDictionaryKey: anahtar) as? [String], let ilk = gruplar.first {
        return ilk
    }
    return "group.com.hatirlaticilarim.app"
}()
private let widgetRemindersKey = "widget-reminders-v1"

// Ana uygulamadan gelen widget görünümünde gereken sınırlı veri modeli.
private enum ReminderPriority: String {
    case normal, important, urgent

    var color: Color {
        switch self {
        case .urgent: return .red
        case .important: return .orange
        case .normal: return .accentColor
        }
    }

    var label: String? {
        switch self {
        case .urgent: return "Acil"
        case .important: return "Önemli"
        case .normal: return nil
        }
    }
}

private struct ReminderWidgetItem {
    let title: String
    let dueAt: Date
    let priority: ReminderPriority
}

private struct ReminderWidgetEntry: TimelineEntry {
    let date: Date
    /// Girişin saatinden sonraki ilk birkaç hatırlatma (orta boy widget en fazla 3 gösterir).
    let upcoming: [ReminderWidgetItem]
    let todayCount: Int

    var nextReminder: ReminderWidgetItem? { upcoming.first }
}

private struct ReminderWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> ReminderWidgetEntry {
        let now = Date.now
        return ReminderWidgetEntry(
            date: now,
            upcoming: [
                ReminderWidgetItem(title: "Örnek hatırlatma", dueAt: now.addingTimeInterval(2 * 3600), priority: .important),
                ReminderWidgetItem(title: "Su iç", dueAt: now.addingTimeInterval(4 * 3600), priority: .normal),
                ReminderWidgetItem(title: "Fatura öde", dueAt: now.addingTimeInterval(26 * 3600), priority: .urgent),
            ],
            todayCount: 3
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (ReminderWidgetEntry) -> Void) {
        completion(loadEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ReminderWidgetEntry>) -> Void) {
        let now = Date.now
        let pending = loadPendingReminders()

        // Her yaklaşan hatırlatmanın saatinde ve gece yarısında yeni bir giriş üretilir;
        // böylece süresi geçen hatırlatma 15 dakika beklemeden widget'tan düşer.
        var entryDates: [Date] = [now]
        entryDates.append(contentsOf: pending
            .map(\.dueAt)
            .filter { $0 > now }
            .prefix(20)
            .map { $0.addingTimeInterval(1) })
        if let midnight = Calendar.current.nextDate(
            after: now,
            matching: DateComponents(hour: 0, minute: 0),
            matchingPolicy: .nextTime
        ) {
            entryDates.append(midnight)
        }

        let entries = Array(Set(entryDates)).sorted().map { makeEntry(at: $0, from: pending) }
        let refreshDate = Calendar.current.date(byAdding: .minute, value: 15, to: now) ?? now.addingTimeInterval(900)
        completion(Timeline(entries: entries, policy: .after(refreshDate)))
    }

    private func loadEntry() -> ReminderWidgetEntry {
        makeEntry(at: .now, from: loadPendingReminders())
    }

    private func loadPendingReminders() -> [ReminderWidgetItem] {
        guard
            let sharedDefaults = UserDefaults(suiteName: widgetAppGroupIdentifier),
            let data = sharedDefaults.data(forKey: widgetRemindersKey),
            let reminders = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else {
            return []
        }

        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallbackDateFormatter = ISO8601DateFormatter()
        return reminders.compactMap { reminder -> ReminderWidgetItem? in
            guard
                (reminder["completed"] as? Bool) != true,
                let title = reminder["title"] as? String,
                let dateString = reminder["dueAt"] as? String,
                let dueAt = dateFormatter.date(from: dateString) ?? fallbackDateFormatter.date(from: dateString)
            else {
                return nil
            }

            let priority = ReminderPriority(rawValue: reminder["priority"] as? String ?? "") ?? .normal
            return ReminderWidgetItem(title: title, dueAt: dueAt, priority: priority)
        }
        .sorted { $0.dueAt < $1.dueAt }
    }

    private func makeEntry(at date: Date, from pendingReminders: [ReminderWidgetItem]) -> ReminderWidgetEntry {
        let calendar = Calendar.current
        // Bugünkü sayaç, zamanı geçmiş ancak tamamlanmamış bugünkü işleri de içerir.
        let todayCount = pendingReminders.filter {
            calendar.isDate($0.dueAt, inSameDayAs: date)
        }.count

        return ReminderWidgetEntry(
            date: date,
            upcoming: Array(pendingReminders.lazy.filter { $0.dueAt > date }.prefix(3)),
            todayCount: todayCount
        )
    }
}

/// Bugünkü hatırlatmada yalnızca saat, diğer günlerde kısa tarih + saat gösterir.
private func formattedDueText(_ dueAt: Date, relativeTo now: Date) -> String {
    if Calendar.current.isDate(dueAt, inSameDayAs: now) {
        return dueAt.formatted(date: .omitted, time: .shortened)
    }
    return dueAt.formatted(.dateTime.day().month(.abbreviated).hour().minute())
}

private struct ReminderWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ReminderWidgetEntry

    var body: some View {
        Group {
            switch family {
            case .accessoryInline:
                inlineContent
            case .accessoryRectangular:
                lockScreenContent
            case .accessoryCircular:
                circularContent
            case .systemMedium:
                mediumContent
            default:
                smallContent
            }
        }
        .widgetBackground
    }

    private var header: some View {
        Label("Hatırlatıcılarım", systemImage: "checkmark.circle.fill")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.tint)
            .lineLimit(1)
    }

    private var todayFooter: some View {
        Text("Bugün: \(entry.todayCount) bekleyen")
            .font(.caption2.weight(.medium))
            .foregroundStyle(.secondary)
    }

    /// Bir saatten az kaldıysa canlı geri sayım, aksi hâlde saat/tarih gösterilir.
    @ViewBuilder
    private func dueText(_ reminder: ReminderWidgetItem) -> some View {
        if reminder.dueAt.timeIntervalSince(entry.date) < 3600 {
            Text(reminder.dueAt, style: .relative)
        } else {
            Text(formattedDueText(reminder.dueAt, relativeTo: entry.date))
        }
    }

    private var smallContent: some View {
        VStack(alignment: .leading, spacing: 6) {
            header
            Spacer(minLength: 0)
            if let reminder = entry.nextReminder {
                if let label = reminder.priority.label {
                    Text(label.uppercased())
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(reminder.priority.color)
                }
                Text(reminder.title)
                    .font(.headline)
                    .lineLimit(3)
                    .minimumScaleFactor(0.8)
                Label {
                    dueText(reminder)
                } icon: {
                    Image(systemName: "clock")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            } else {
                emptyState
            }
            Spacer(minLength: 0)
            todayFooter
        }
        .padding()
    }

    private var mediumContent: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                header
                Spacer(minLength: 0)
                Text("\(entry.todayCount)")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6)
                Text("bugün bekleyen")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: 110, alignment: .leading)

            VStack(alignment: .leading, spacing: 8) {
                if entry.upcoming.isEmpty {
                    Spacer(minLength: 0)
                    emptyState
                    Spacer(minLength: 0)
                } else {
                    ForEach(Array(entry.upcoming.enumerated()), id: \.offset) { _, reminder in
                        HStack(alignment: .top, spacing: 8) {
                            Capsule()
                                .fill(reminder.priority.color)
                                .frame(width: 4, height: 30)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(reminder.title)
                                    .font(.subheadline.weight(.semibold))
                                    .lineLimit(1)
                                dueText(reminder)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Yaklaşan hatırlatma yok")
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)
            Text("Yeni bir hatırlatma ekleyin.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var lockScreenContent: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("SIRADAKİ HATIRLATMA")
                .font(.caption2.weight(.semibold))
                .lineLimit(1)
            if let reminder = entry.nextReminder {
                Text(reminder.title)
                    .font(.headline)
                    .lineLimit(1)
                dueText(reminder)
                    .font(.caption)
            } else {
                Text("Yaklaşan hatırlatma yok")
                    .font(.headline)
                    .lineLimit(2)
            }
        }
    }

    private var circularContent: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text("\(entry.todayCount)")
                    .font(.system(.title2, design: .rounded).weight(.bold))
                    .minimumScaleFactor(0.6)
                Text("bugün")
                    .font(.system(size: 9, weight: .medium))
            }
        }
        .widgetAccentable()
    }

    @ViewBuilder
    private var inlineContent: some View {
        if let reminder = entry.nextReminder {
            Text("\(formattedDueText(reminder.dueAt, relativeTo: entry.date)) · \(reminder.title)")
        } else {
            Text("Yaklaşan hatırlatma yok")
        }
    }
}

private extension View {
    @ViewBuilder
    var widgetBackground: some View {
        // iOS 26 sistem Liquid Glass yüzeyini kullanır; eski sürümlerde materyale döner.
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) {
                Color.clear
            }
        } else {
            background(.regularMaterial)
        }
    }
}

@main
struct HatirlaticilarimWidget: Widget {
    let kind = "HatirlaticilarimWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ReminderWidgetProvider()) { entry in
            ReminderWidgetView(entry: entry)
        }
        .configurationDisplayName("Sıradaki Hatırlatma")
        .description("Yaklaşan hatırlatmaları ve bugünkü bekleyen sayısını gösterir.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryInline,
            .accessoryRectangular,
            .accessoryCircular,
        ])
    }
}
