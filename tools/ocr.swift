// Läser text på ett foto med macOS inbyggda textigenkänning (Vision).
// Används när ägaren fotar menyn. Kör: ocr <bild>  ->  JSON-rader på stdout.
import Foundation
import Vision

guard CommandLine.arguments.count > 1,
      let image = CGImageSourceCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL, nil)
        .flatMap({ CGImageSourceCreateImageAtIndex($0, 0, nil) }) else {
    FileHandle.standardError.write("Kunde inte läsa bilden\n".data(using: .utf8)!)
    exit(2)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }

do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
} catch {
    FileHandle.standardError.write("Textigenkänningen misslyckades: \(error)\n".data(using: .utf8)!)
    exit(3)
}

// x, y = vänster och överkant (0–1, uppifrån), h = radens höjd (större text = rubrik)
var rows: [[String: Any]] = []
for case let obs as VNRecognizedTextObservation in request.results ?? [] {
    guard let best = obs.topCandidates(1).first else { continue }
    let box = obs.boundingBox
    rows.append(["text": best.string, "x": box.minX, "y": 1 - box.maxY, "h": box.height])
}
let data = try! JSONSerialization.data(withJSONObject: rows)
FileHandle.standardOutput.write(data)
