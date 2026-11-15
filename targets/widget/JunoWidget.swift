import SwiftUI
import WidgetKit

// Every widget here only opens a link into the app. The app decides what each link does
// (src/links/appLinks.ts); nothing is shared between the widget and the app.

private enum JunoLink {
  static let feed = URL(string: "juno://feed")!
  static let agent = URL(string: "juno://agent")!
}

private extension Color {
  static let junoNavy = Color(red: 15 / 255, green: 27 / 255, blue: 61 / 255)
  static let junoGold = Color(red: 241 / 255, green: 188 / 255, blue: 76 / 255)
}

struct JunoEntry: TimelineEntry {
  let date: Date
}

struct JunoProvider: TimelineProvider {
  func placeholder(in context: Context) -> JunoEntry { JunoEntry(date: .now) }

  func getSnapshot(in context: Context, completion: @escaping (JunoEntry) -> Void) {
    completion(JunoEntry(date: .now))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<JunoEntry>) -> Void) {
    completion(Timeline(entries: [JunoEntry(date: .now)], policy: .never))
  }
}

private struct JunoButton: View {
  let title: String
  let symbol: String

  var body: some View {
    VStack(spacing: 6) {
      Image(systemName: symbol)
        .font(.title.weight(.bold))
      Text(title)
        .font(.title3.weight(.heavy))
        .multilineTextAlignment(.center)
        .lineLimit(2)
        .minimumScaleFactor(0.7)
    }
    .foregroundStyle(Color.junoNavy)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(8)
    .background(Color.junoGold, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
  }
}

struct JunoWidgetView: View {
  @Environment(\.widgetFamily) private var family

  var body: some View {
    if family == .systemMedium {
      HStack(spacing: 12) {
        Link(destination: JunoLink.feed) {
          JunoButton(title: "Listen to my feed", symbol: "headphones")
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Listen to my feed")
        .accessibilityHint("Opens Juno and reads the post in focus.")
        .accessibilityAddTraits(.isButton)
        Link(destination: JunoLink.agent) {
          JunoButton(title: "Talk to Juno", symbol: "waveform")
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Talk to Juno")
        .accessibilityHint("Opens Juno and wakes the voice agent.")
        .accessibilityAddTraits(.isButton)
      }
    } else {
      VStack(alignment: .leading, spacing: 8) {
        Image(systemName: "headphones")
          .font(.largeTitle.weight(.bold))
        Spacer(minLength: 0)
        Text("Listen to my feed")
          .font(.title2.weight(.heavy))
          .lineLimit(3)
          .minimumScaleFactor(0.7)
      }
      .foregroundStyle(Color.junoGold)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .widgetURL(JunoLink.feed)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("Listen to my feed")
      .accessibilityHint("Opens Juno and reads the post in focus.")
      .accessibilityAddTraits(.isButton)
    }
  }
}

struct JunoWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "JunoWidget", provider: JunoProvider()) { _ in
      JunoWidgetView()
        .containerBackground(Color.junoNavy, for: .widget)
    }
    .configurationDisplayName("Juno")
    .description("Listen to your feed, or talk to Juno, with one tap.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct JunoAgentAccessoryView: View {
  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      Image(systemName: "waveform")
        .font(.title2.weight(.bold))
    }
    .widgetURL(JunoLink.agent)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Talk to Juno")
    .accessibilityHint("Opens Juno and wakes the voice agent.")
    .accessibilityAddTraits(.isButton)
  }
}

struct JunoAgentAccessory: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "JunoAgentAccessory", provider: JunoProvider()) { _ in
      JunoAgentAccessoryView()
        .containerBackground(.clear, for: .widget)
    }
    .configurationDisplayName("Talk to Juno")
    .description("Wakes Juno's voice agent from the Lock Screen.")
    .supportedFamilies([.accessoryCircular])
  }
}

@main
struct JunoWidgets: WidgetBundle {
  var body: some Widget {
    JunoWidget()
    JunoAgentAccessory()
  }
}
