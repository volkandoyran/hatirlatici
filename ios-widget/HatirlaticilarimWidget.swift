import SwiftUI
import WidgetKit

private let widgetAppGroupIdentifier = "group.com.hatirlaticilarim.app"
private let widgetRemindersKey = "widget-reminders-v1"

// Ana uygulamadan gelen widget görünümünde gereken sınırlı veri modeli.
private struct ReminderWidgetItem {
    let title: String
    let dueAt: Date
}

private struct ReminderWidgetEntry: TimelineEntry {
    let date: Date
    let nextReminder: ReminderWidgetItem?
    let todayCount: Int

    static var empty: ReminderWidgetEntry {
        ReminderWidgetEntry(date: .now, nextReminder: nil, todayCount: 0)
    }
}

private struct ReminderWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> ReminderWidgetEntry {
        ReminderWidgetEntry(
            date: .now,
            nextReminder: ReminderWidgetItem(
                title: "Örnek hatırlatma",
                dueAt: Calendar.current.date(byAdding: .hour, value: 2, to: .now) ?? .now
            ),
            todayCount: 3
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (ReminderWidgetEntry) -> Void) {
        completion(loadEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ReminderWidgetEntry>) -> Void) {
        let entry = loadEntry()
        let refreshDate = Calendar.current.date(byAdding: .minute, value: 15, to: .now) ?? .now.addingTimeInterval(900)
        completion(Timeline(entries: [entry], policy: .after(refreshDate)))
    }

    private func loadEntry() -> ReminderWidgetEntry {
        guard
            let sharedDefaults = UserDefaults(suiteName: widgetAppGroupIdentifier),
            let data = sharedDefaults.data(forKey: widgetRemindersKey),
            let reminders = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else {
            return .empty
        }

        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallbackDateFormatter = ISO8601DateFormatter()
        let pendingReminders = reminders.compactMap { reminder -> ReminderWidgetItem? in
            guard
                let isCompleted = reminder["completed"] as? Bool,
                !isCompleted,
                let title = reminder["title"] as? String,
                let dateString = reminder["dueAt"] as? String,
                let dueAt = dateFormatter.date(from: dateString) ?? fallbackDateFormatter.date(from: dateString)
            else {
                return nil
            }

            return ReminderWidgetItem(title: title, dueAt: dueAt)
        }
        .sorted { $0.dueAt < $1.dueAt }

        let upcomingReminders = pendingReminders.filter { $0.dueAt > .now }
        // Bugünkü sayaç, zamanı geçmiş ancak tamamlanmamış bugünkü işleri de içerir.
        let todayCount = pendingReminders.filter {
            Calendar.current.isDateInToday($0.dueAt)
        }.count

        return ReminderWidgetEntry(
            date: .now,
            nextReminder: upcomingReminders.first,
            todayCount: todayCount
        )
    }
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
            default:
                homeScreenContent
            }
        }
        .widgetBackground
    }

    private var homeScreenContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Hatırlatıcılarım", systemImage: "checkmark.circle.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tint)
                .lineLimit(1)

            if let reminder = entry.nextReminder {
                Text(reminder.title)
                    .font(.headline)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Label {
                    Text(reminder.dueAt, style: .time)
                } icon: {
                    Image(systemName: "clock")
                }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Text("Bugün: \(entry.todayCount) bekleyen")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
            } else {
                Spacer(minLength: 0)
                Text("Yaklaşan hatırlatma yok")
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Yeni bir hatırlatma ekleyin.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Text("Bugün: \(entry.todayCount) bekleyen")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
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
                Text(reminder.dueAt, style: .time)
                    .font(.caption)
            } else {
                Text("Yaklaşan hatırlatma yok")
                    .font(.headline)
                    .lineLimit(2)
            }
        }
    }

    private var inlineContent: some View {
        if let reminder = entry.nextReminder {
            Text("\(reminder.dueAt.formatted(date: .omitted, time: .shortened)) · \(reminder.title)")
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
        .description("Yaklaşan hatırlatmayı ve bugünkü bekleyen sayısını gösterir.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryInline,
            .accessoryRectangular,
        ])
    }
}
