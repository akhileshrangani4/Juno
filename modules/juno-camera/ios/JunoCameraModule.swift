import AVFoundation
import ExpoModulesCore
import UIKit

public final class JunoCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("JunoCamera")

    Function("cameraPermission") { () -> String in
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized: return "granted"
      case .denied: return "denied"
      case .restricted: return "restricted"
      default: return "undetermined"
      }
    }

    AsyncFunction("requestCameraPermission") { (promise: Promise) in
      AVCaptureDevice.requestAccess(for: .video) { granted in promise.resolve(granted) }
    }

    // A voice call records audio, and iOS mutes haptics and system sounds while an app records unless it opts
    // in. The camera's guidance ticks and shutter sound must still be felt and heard during a call.
    // Returns the session's setting afterwards, so a log can show whether it took.
    Function("allowHapticsDuringRecording") { (allow: Bool) -> Bool in
      try? AVAudioSession.sharedInstance().setAllowHapticsAndSystemSoundsDuringRecording(allow)
      return AVAudioSession.sharedInstance().allowHapticsAndSystemSoundsDuringRecording
    }

    // The development frame source runs only in simulator builds; a build for a phone has no analyzeImage at all.
    #if targetEnvironment(simulator)
    Constant("devFramesSupported") { true }

    // The same measurements as live frames, for a still image (the development frame source on a simulator).
    AsyncFunction("analyzeImage") { (uri: URL, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        guard let data = try? Data(contentsOf: uri), let image = UIImage(data: data), let upright = JunoCameraModule.upright(image) else {
          return promise.reject("E_IMAGE", "The image could not be read")
        }
        var result = FrameAnalyzer().analyze(image: upright)
        result["timestamp"] = CACurrentMediaTime() * 1000
        promise.resolve(result)
      }
    }
    #endif

    View(JunoCameraView.self) {
      Events("onAnalysis", "onReady", "onCameraError")

      Prop("facing") { (view: JunoCameraView, facing: String) in
        view.setFacing(facing)
      }

      Prop("active") { (view: JunoCameraView, active: Bool) in
        view.setActive(active)
      }

      AsyncFunction("snapshot") { (view: JunoCameraView, maxDimension: Int, mirror: Bool, promise: Promise) in
        view.snapshot(maxDimension: maxDimension, mirror: mirror, promise: promise)
      }

      AsyncFunction("takePhoto") { (view: JunoCameraView, promise: Promise) in
        view.takePhoto(promise: promise)
      }
    }
  }

  private static func upright(_ image: UIImage) -> CGImage? {
    if image.imageOrientation == .up { return image.cgImage }
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: image.size, format: format).image { _ in image.draw(at: .zero) }.cgImage
  }
}
