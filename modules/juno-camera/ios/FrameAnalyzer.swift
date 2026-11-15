import CoreImage
import CoreVideo
import UIKit
import Vision

// Measures one upright, un-mirrored frame on the device: face rectangles, the most salient region, sharpness,
// brightness, a coarse 8x8 brightness signature for scene-change checks, and motion against the previous frame.
// Boxes are normalized to the image with the origin at the top left. Nothing here touches the network.
final class FrameAnalyzer {
  private static let gridWidth = 96
  private static let gridHeight = 128
  private var previousGrid: [Float]?

  func analyze(pixelBuffer: CVPixelBuffer) -> [String: Any] {
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
    let grid = lumaGrid(pixelBuffer: pixelBuffer)
    return measure(handler: handler, grid: grid, width: CVPixelBufferGetWidth(pixelBuffer), height: CVPixelBufferGetHeight(pixelBuffer))
  }

  func analyze(image: CGImage) -> [String: Any] {
    previousGrid = nil
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    return measure(handler: handler, grid: lumaGrid(image: image), width: image.width, height: image.height)
  }

  func reset() {
    previousGrid = nil
  }

  private func measure(handler: VNImageRequestHandler, grid: [Float], width: Int, height: Int) -> [String: Any] {
    let faces = VNDetectFaceRectanglesRequest()
    let saliency = VNGenerateObjectnessBasedSaliencyImageRequest()
    #if targetEnvironment(simulator)
    faces.usesCPUOnly = true
    saliency.usesCPUOnly = true
    #endif
    try? handler.perform([faces])
    try? handler.perform([saliency])

    let faceBoxes = (faces.results ?? []).map { FrameAnalyzer.box($0.boundingBox) }
    let salientObject = (saliency.results?.first?.salientObjects ?? []).max { a, b in
      a.boundingBox.width * a.boundingBox.height < b.boundingBox.width * b.boundingBox.height
    }

    var motion: Float = 0
    if let previous = previousGrid, previous.count == grid.count {
      var total: Float = 0
      for i in 0..<grid.count { total += abs(grid[i] - previous[i]) }
      motion = total / Float(grid.count)
    }
    previousGrid = grid

    return [
      "faces": faceBoxes,
      "salient": salientObject.map { FrameAnalyzer.box($0.boundingBox) as Any } ?? NSNull(),
      "sharpness": Double(FrameAnalyzer.laplacianVariance(grid)),
      "brightness": Double(grid.reduce(0, +) / Float(grid.count)),
      "motion": Double(motion),
      "signature": FrameAnalyzer.signature(grid),
      "width": width,
      "height": height,
    ]
  }

  private static func box(_ rect: CGRect) -> [String: Double] {
    ["x": Double(rect.minX), "y": Double(1 - rect.maxY), "width": Double(rect.width), "height": Double(rect.height)]
  }

  // Brightness 0...1 sampled on a coarse grid from the luma plane of a bi-planar YUV frame.
  private func lumaGrid(pixelBuffer: CVPixelBuffer) -> [Float] {
    let width = FrameAnalyzer.gridWidth
    let height = FrameAnalyzer.gridHeight
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
    guard CVPixelBufferGetPlaneCount(pixelBuffer) > 0, let base = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0) else {
      return [Float](repeating: 0, count: width * height)
    }
    let planeWidth = CVPixelBufferGetWidthOfPlane(pixelBuffer, 0)
    let planeHeight = CVPixelBufferGetHeightOfPlane(pixelBuffer, 0)
    let stride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0)
    let bytes = base.assumingMemoryBound(to: UInt8.self)
    var grid = [Float](repeating: 0, count: width * height)
    for row in 0..<height {
      let y = min(planeHeight - 1, row * planeHeight / height)
      for column in 0..<width {
        let x = min(planeWidth - 1, column * planeWidth / width)
        grid[row * width + column] = Float(bytes[y * stride + x]) / 255
      }
    }
    return grid
  }

  private func lumaGrid(image: CGImage) -> [Float] {
    let width = FrameAnalyzer.gridWidth
    let height = FrameAnalyzer.gridHeight
    var pixels = [UInt8](repeating: 0, count: width * height)
    pixels.withUnsafeMutableBytes { buffer in
      guard let context = CGContext(
        data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue
      ) else { return }
      context.interpolationQuality = .low
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
    return pixels.map { Float($0) / 255 }
  }

  // Variance of the Laplacian, scaled to 0-255 brightness steps: low for a blurred or shaken frame.
  private static func laplacianVariance(_ grid: [Float]) -> Float {
    let width = gridWidth
    let height = gridHeight
    var values: [Float] = []
    values.reserveCapacity((width - 2) * (height - 2))
    for row in 1..<(height - 1) {
      for column in 1..<(width - 1) {
        let i = row * width + column
        let value = grid[i - width] + grid[i + width] + grid[i - 1] + grid[i + 1] - 4 * grid[i]
        values.append(value * 255)
      }
    }
    let mean = values.reduce(0, +) / Float(values.count)
    return values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Float(values.count)
  }

  private static func signature(_ grid: [Float]) -> [Double] {
    let cells = 8
    let cellWidth = gridWidth / cells
    let cellHeight = gridHeight / cells
    var result = [Double](repeating: 0, count: cells * cells)
    for cellRow in 0..<cells {
      for cellColumn in 0..<cells {
        var total: Float = 0
        for row in 0..<cellHeight {
          for column in 0..<cellWidth {
            total += grid[(cellRow * cellHeight + row) * gridWidth + cellColumn * cellWidth + column]
          }
        }
        result[cellRow * cells + cellColumn] = Double(total / Float(cellWidth * cellHeight))
      }
    }
    return result
  }
}
