import AppKit
import PDFKit
let pdf = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
let page = pdf.page(at: Int(CommandLine.arguments[2])! - 1)!
let image = page.thumbnail(of: NSSize(width: 1800, height: 2500), for: .mediaBox)
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[3]))
print("rendered page", CommandLine.arguments[2], "pages", pdf.pageCount)
