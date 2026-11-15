import AVFoundation
import CoreImage
import ExpoModulesCore
import ImageIO
import UIKit

// The live camera: an AVCaptureSession with a preview layer, a video data output measured by FrameAnalyzer about
// eight times a second, and a photo output. Frames are rotated upright and never mirrored, so measurements are
// in the camera's true image; the JavaScript side turns them into directions for each camera. The session adds
// no audio input and does not configure the app's audio session, so a voice call and speech keep theirs.
final class JunoCameraView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate {
  let onAnalysis = EventDispatcher()
  let onReady = EventDispatcher()
  let onCameraError = EventDispatcher()

  private static let analysisInterval: CFTimeInterval = 0.12

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "juno.camera.session")
  private let frameQueue = DispatchQueue(label: "juno.camera.frames")
  private let videoOutput = AVCaptureVideoDataOutput()
  private let photoOutput = AVCapturePhotoOutput()
  private let previewLayer: AVCaptureVideoPreviewLayer
  private let analyzer = FrameAnalyzer()
  private let ciContext = CIContext()
  private var position: AVCaptureDevice.Position = .back
  private var wantsRunning = false
  private var outputsAdded = false
  private var lastAnalysis: CFTimeInterval = 0
  private var latestFrame: CVPixelBuffer?
  private var photoPromises: [Int64: Promise] = [:]
  private let photoLock = NSLock()

  required init(appContext: AppContext? = nil) {
    previewLayer = AVCaptureVideoPreviewLayer(session: session)
    super.init(appContext: appContext)
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
    accessibilityElementsHidden = true
    session.automaticallyConfiguresApplicationAudioSession = false
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }

  override func removeFromSuperview() {
    setActive(false)
    super.removeFromSuperview()
  }

  func setFacing(_ facing: String) {
    let next: AVCaptureDevice.Position = facing == "front" ? .front : .back
    sessionQueue.async {
      guard next != self.position else { return }
      self.position = next
      if self.wantsRunning { self.configure() }
    }
  }

  func setActive(_ active: Bool) {
    sessionQueue.async {
      self.wantsRunning = active
      if active {
        self.configure()
      } else if self.session.isRunning {
        self.session.stopRunning()
      }
    }
  }

  private func configure() {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      return emit(onCameraError, ["reason": "permission"])
    }
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
          let input = try? AVCaptureDeviceInput(device: device) else {
      return emit(onCameraError, ["reason": "unavailable"])
    }
    session.beginConfiguration()
    session.sessionPreset = .high
    session.inputs.forEach { session.removeInput($0) }
    guard session.canAddInput(input) else {
      session.commitConfiguration()
      return emit(onCameraError, ["reason": "unavailable"])
    }
    session.addInput(input)
    if !outputsAdded, session.canAddOutput(videoOutput), session.canAddOutput(photoOutput) {
      videoOutput.alwaysDiscardsLateVideoFrames = true
      videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
      videoOutput.setSampleBufferDelegate(self, queue: frameQueue)
      session.addOutput(videoOutput)
      session.addOutput(photoOutput)
      outputsAdded = true
    }
    [videoOutput.connection(with: .video), photoOutput.connection(with: .video)].compactMap { $0 }.forEach(JunoCameraView.upright)
    session.commitConfiguration()
    frameQueue.async {
      self.analyzer.reset()
      self.latestFrame = nil
    }
    if !session.isRunning { session.startRunning() }
    emit(onReady, ["facing": position == .front ? "front" : "back"])
  }

  private static func upright(_ connection: AVCaptureConnection) {
    if #available(iOS 17.0, *) {
      if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
    } else if connection.isVideoOrientationSupported {
      connection.videoOrientation = .portrait
    }
    if connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = false
    }
  }

  private func emit(_ dispatcher: EventDispatcher, _ payload: [String: Any]) {
    DispatchQueue.main.async { dispatcher(payload) }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    latestFrame = pixelBuffer
    let now = CACurrentMediaTime()
    guard now - lastAnalysis >= JunoCameraView.analysisInterval else { return }
    lastAnalysis = now
    var result = analyzer.analyze(pixelBuffer: pixelBuffer)
    result["timestamp"] = now * 1000
    emit(onAnalysis, result)
  }

  // A downscaled JPEG of the latest frame, for descriptions and decision checks. Mirrored on request, so a
  // front-camera frame matches the mirror-like preview and left and right are the user's own.
  func snapshot(maxDimension: Int, mirror: Bool, promise: Promise) {
    frameQueue.async {
      guard let frame = self.latestFrame else { return promise.reject("E_NO_FRAME", "The camera has no frame yet") }
      var image = CIImage(cvPixelBuffer: frame)
      if mirror {
        image = image.transformed(by: CGAffineTransform(scaleX: -1, y: 1).translatedBy(x: -image.extent.width, y: 0))
      }
      let scale = min(1, (CGFloat(maxDimension) - 1) / max(image.extent.width, image.extent.height))
      image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
      let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
      let options = [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.6]
      guard let data = self.ciContext.jpegRepresentation(of: image, colorSpace: space, options: options) else {
        return promise.reject("E_ENCODE", "The frame could not be encoded")
      }
      promise.resolve(["base64": data.base64EncodedString(), "width": Int(image.extent.width), "height": Int(image.extent.height)])
    }
  }

  func takePhoto(promise: Promise) {
    sessionQueue.async {
      guard self.session.isRunning, self.photoOutput.connection(with: .video) != nil else {
        return promise.reject("E_NOT_RUNNING", "The camera is not running")
      }
      let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
      self.photoLock.lock()
      self.photoPromises[settings.uniqueID] = promise
      self.photoLock.unlock()
      self.photoOutput.capturePhoto(with: settings, delegate: self)
    }
  }

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    photoLock.lock()
    let promise = photoPromises.removeValue(forKey: photo.resolvedSettings.uniqueID)
    photoLock.unlock()
    guard let promise else { return }
    let data = photo.fileDataRepresentation()
    DispatchQueue.global(qos: .userInitiated).async {
      if let error { return promise.reject("E_CAPTURE", error.localizedDescription) }
      guard let data else { return promise.reject("E_CAPTURE", "The photo had no data") }
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("juno-photo-\(UUID().uuidString).jpg")
      do {
        try data.write(to: url)
      } catch {
        return promise.reject("E_WRITE", error.localizedDescription)
      }
      let size = UIImage(data: data)?.size ?? .zero
      promise.resolve(["uri": url.absoluteString, "width": Int(size.width), "height": Int(size.height)])
    }
  }
}
