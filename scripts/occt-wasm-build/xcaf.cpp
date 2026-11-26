// SPDX-License-Identifier: MIT
#include <array>
#include <emscripten/bind.h>
#include <Quantity_Color.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <STEPCAFControl_Writer.hxx>
#include <TDataStd_Name.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDocStd_Document.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>

using namespace emscripten;
using RGB = std::array<double, 3>;

EMSCRIPTEN_BINDINGS(xcaf) {
  value_array<RGB>("RGB").element(emscripten::index<0>()).element(emscripten::index<1>()).element(emscripten::index<2>());
  class_<TDF_Label>("TDF_Label").function("IsNull", &TDF_Label::IsNull);
  class_<TDF_LabelSequence>("TDF_LabelSequence")
    .function("Length", +[](const TDF_LabelSequence& labels) { return labels.Length(); })
    .function("Value", +[](const TDF_LabelSequence& labels, int i) { return labels.Value(i); });
  class_<TDocStd_Document>("TDocStd_Document").smart_ptr<Handle(TDocStd_Document)>("Handle_TDocStd_Document")
    .function("Main", +[](const TDocStd_Document& document) { return document.Main(); });
  class_<XCAFApp_Application>("XCAFApp_Application").smart_ptr<Handle(XCAFApp_Application)>("Handle_XCAFApp_Application")
    .class_function("GetApplication", +[] { return XCAFApp_Application::GetApplication(); })
    .function("NewDocument", +[](XCAFApp_Application& application) {
      Handle(TDocStd_Document) document;
      application.NewDocument(TCollection_ExtendedString("BinXCAF"), document);
      return document;
    })
    .function("Close", +[](XCAFApp_Application& application, const Handle(TDocStd_Document)& document) {
      application.Close(document);
    });
  class_<XCAFDoc_DocumentTool>("XCAFDoc_DocumentTool")
    .class_function("ShapeTool", &XCAFDoc_DocumentTool::ShapeTool)
    .class_function("ColorTool", &XCAFDoc_DocumentTool::ColorTool);
  class_<XCAFDoc_ShapeTool>("XCAFDoc_ShapeTool").smart_ptr<Handle(XCAFDoc_ShapeTool)>("Handle_XCAFDoc_ShapeTool")
    .function("GetFreeShapes", +[](const XCAFDoc_ShapeTool& tool) {
      TDF_LabelSequence labels;
      tool.GetFreeShapes(labels);
      return labels;
    })
    .class_function("GetComponents", +[](const TDF_Label& assembly) {
      TDF_LabelSequence labels;
      XCAFDoc_ShapeTool::GetComponents(assembly, labels, false);
      return labels;
    })
    .class_function("GetReferredShape", +[](const TDF_Label& instance) {
      TDF_Label label;
      XCAFDoc_ShapeTool::GetReferredShape(instance, label);
      return label;
    })
    .class_function("GetShape", select_overload<TopoDS_Shape(const TDF_Label&)>(&XCAFDoc_ShapeTool::GetShape))
    .class_function("GetLocation", &XCAFDoc_ShapeTool::GetLocation)
    .class_function("IsAssembly", &XCAFDoc_ShapeTool::IsAssembly)
    .function("NewShape", &XCAFDoc_ShapeTool::NewShape)
    .function("AddShape", &XCAFDoc_ShapeTool::AddShape)
    .function("AddComponent", select_overload<TDF_Label(const TDF_Label&, const TDF_Label&, const TopLoc_Location&)>(
      &XCAFDoc_ShapeTool::AddComponent))
    .class_function("GetSubShapes", +[](const TDF_Label& definition) {
      TDF_LabelSequence labels;
      XCAFDoc_ShapeTool::GetSubShapes(definition, labels);
      return labels;
    })
    .function("AddSubShape", select_overload<TDF_Label(const TDF_Label&, const TopoDS_Shape&) const>(
      &XCAFDoc_ShapeTool::AddSubShape))
    .function("UpdateAssemblies", &XCAFDoc_ShapeTool::UpdateAssemblies);
  enum_<XCAFDoc_ColorType>("XCAFDoc_ColorType")
    .value("XCAFDoc_ColorGen", XCAFDoc_ColorGen).value("XCAFDoc_ColorSurf", XCAFDoc_ColorSurf)
    .value("XCAFDoc_ColorCurv", XCAFDoc_ColorCurv);
  class_<XCAFDoc_ColorTool>("XCAFDoc_ColorTool").smart_ptr<Handle(XCAFDoc_ColorTool)>("Handle_XCAFDoc_ColorTool")
    .function("SetColor", +[](const XCAFDoc_ColorTool& tool, const TDF_Label& label, const RGB& rgb, XCAFDoc_ColorType type) {
      tool.SetColor(label, Quantity_Color(rgb[0], rgb[1], rgb[2], Quantity_TOC_sRGB), type);
    })
    .class_function("GetColor", +[](const TDF_Label& label, XCAFDoc_ColorType type) -> val {
      Quantity_Color color;
      if (!XCAFDoc_ColorTool::GetColor(label, type, color)) return val::null();
      RGB rgb;
      color.Values(rgb[0], rgb[1], rgb[2], Quantity_TOC_sRGB);
      return val(rgb);
    });
  class_<TDataStd_Name>("TDataStd_Name")
    .class_function("Set", +[](const TDF_Label& label, const std::string& name) {
      TDataStd_Name::Set(label, TCollection_ExtendedString(name.c_str(), true));
    })
    .class_function("Get", +[](const TDF_Label& label) {
      Handle(TDataStd_Name) name;
      if (!label.FindAttribute(TDataStd_Name::GetID(), name)) return std::string();
      const auto& value = name->Get();
      std::string buffer(value.LengthOfCString() + 1, '\0');
      auto chars = buffer.data();
      buffer.resize(value.ToUTF8CString(chars));
      return buffer;
    });
  class_<STEPCAFControl_Reader>("STEPCAFControl_Reader").constructor<>()
    .function("SetNameMode", &STEPCAFControl_Reader::SetNameMode)
    .function("SetColorMode", &STEPCAFControl_Reader::SetColorMode)
    .function("ReadFile", +[](STEPCAFControl_Reader& reader, const std::string& file) {
      return reader.ReadFile(file.c_str());
    })
    .function("Transfer", +[](STEPCAFControl_Reader& reader, Handle(TDocStd_Document) document,
                              const Message_ProgressRange& progress) {
      return reader.Transfer(document, progress);
    });
  class_<STEPCAFControl_Writer>("STEPCAFControl_Writer").constructor<>()
    .function("SetNameMode", &STEPCAFControl_Writer::SetNameMode)
    .function("SetColorMode", &STEPCAFControl_Writer::SetColorMode)
    .function("Transfer", +[](STEPCAFControl_Writer& writer, const Handle(TDocStd_Document)& document,
                              const Message_ProgressRange& progress) {
      return writer.Transfer(document, STEPControl_AsIs, nullptr, progress);
    })
    .function("Write", +[](STEPCAFControl_Writer& writer, const std::string& file) {
      return writer.Write(file.c_str());
    });
}
