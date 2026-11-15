import AppIntents
import Foundation

// Siri, Shortcuts, Spotlight and Action Button commands. Each one only opens the app at a link; the app decides
// what the link does (src/links/appLinks.ts). Nothing runs in the background and nothing is published from here.

@available(iOS 18.0, *)
struct ReadMyFeedIntent: AppIntent {
  static let title: LocalizedStringResource = "Read my feed"
  static let description = IntentDescription("Opens Juno and reads the post in focus.")

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "juno://feed")!))
  }
}

@available(iOS 18.0, *)
struct TalkToJunoIntent: AppIntent {
  static let title: LocalizedStringResource = "Talk to Juno"
  static let description = IntentDescription("Opens Juno and wakes the voice agent.")

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "juno://agent")!))
  }
}

@available(iOS 18.0, *)
struct PostWithJunoIntent: AppIntent {
  static let title: LocalizedStringResource = "Post with Juno"
  static let description = IntentDescription("Opens Juno and asks what you would like to post. Nothing is posted until you hear it read back and say yes.")

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "juno://post")!))
  }
}

@available(iOS 18.0, *)
struct JunoShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: ReadMyFeedIntent(),
      phrases: ["Read my feed in \(.applicationName)", "Read my \(.applicationName) feed", "Listen to my feed in \(.applicationName)"],
      shortTitle: "Read my feed",
      systemImageName: "headphones"
    )
    AppShortcut(
      intent: TalkToJunoIntent(),
      phrases: ["Talk to \(.applicationName)", "Wake \(.applicationName)"],
      shortTitle: "Talk to Juno",
      systemImageName: "waveform"
    )
    AppShortcut(
      intent: PostWithJunoIntent(),
      phrases: ["Post with \(.applicationName)", "Write a post in \(.applicationName)"],
      shortTitle: "Post with Juno",
      systemImageName: "square.and.pencil"
    )
  }
}
