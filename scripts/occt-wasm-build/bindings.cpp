// SPDX-License-Identifier: MIT
#include <emscripten/bind.h>
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepLib.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <HLRBRep_Algo.hxx>
#include <HLRBRep_HLRToShape.hxx>
#include <Poly_Triangulation.hxx>
#include <Precision.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Builder.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Solid.hxx>
#include <gp_Circ.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Pln.hxx>

using namespace emscripten;
#define CLASS(type) class_<type>(#type)
#define DERIVED(type, parent) class_<type, base<parent>>(#type)
#define METHOD(type, name) function(#name, &type::name)
#define ENUM_VALUE(name) value(#name, name)
#define COPY_GET(type, name) function(#name, +[](type& self) { return self.name(); })
#define BUILDER(type) COPY_GET(type, Shape).function("IsDone", +[](type& self) { return self.IsDone(); })
#define BOOLEAN(type) CLASS(type).constructor<const TopoDS_Shape&, const TopoDS_Shape&, const Message_ProgressRange&>() \
  .BUILDER(type).function("HasErrors", +[](type& self) { return self.HasErrors(); }) \
  .function("SimplifyResult", +[](type& self, bool edges, bool faces, double angularTolerance) { \
    self.SimplifyResult(edges, faces, angularTolerance); \
  })
#define XYZ(type) METHOD(type, X).METHOD(type, Y).METHOD(type, Z)

struct SurfaceD1 {
  gp_Pnt Point;
  gp_Vec D1U;
  gp_Vec D1V;
};

// A retaining handle makes the algorithm safe if its JS wrapper is disposed first.
struct HlrAlgorithm {
  Handle(HLRBRep_Algo) impl = new HLRBRep_Algo();
  void Projector(const HLRAlgo_Projector& projector) { impl->Projector(projector); }
  void Add(const TopoDS_Shape& shape, int isoCount) { impl->Add(shape, isoCount); }
  void Update() { impl->Update(); }
  void Hide() { impl->Hide(); }
};

EMSCRIPTEN_BINDINGS(geometry) {
  CLASS(Message_ProgressRange).constructor<>();
  CLASS(gp_Trsf).constructor<>().METHOD(gp_Trsf, Value).METHOD(gp_Trsf, SetValues)
    .function("SetRotation", select_overload<void(const gp_Ax1&, double)>(&gp_Trsf::SetRotation));
  CLASS(gp_Pnt).constructor<double, double, double>().XYZ(gp_Pnt).METHOD(gp_Pnt, Transform);
  CLASS(gp_Dir).constructor<double, double, double>().XYZ(gp_Dir)
    .METHOD(gp_Dir, Transform).METHOD(gp_Dir, Transformed);
  CLASS(gp_Vec).constructor<double, double, double>().XYZ(gp_Vec).METHOD(gp_Vec, Transform);
  CLASS(gp_Ax1).constructor<const gp_Pnt&, const gp_Dir&>()
    .COPY_GET(gp_Ax1, Location).COPY_GET(gp_Ax1, Direction);
  CLASS(gp_Ax2).constructor<const gp_Pnt&, const gp_Dir&>()
    .constructor<const gp_Pnt&, const gp_Dir&, const gp_Dir&>();
  CLASS(gp_Pln).COPY_GET(gp_Pln, Axis).COPY_GET(gp_Pln, Location);
  CLASS(gp_Circ).COPY_GET(gp_Circ, Axis).METHOD(gp_Circ, Radius);
  CLASS(gp_Cylinder).COPY_GET(gp_Cylinder, Axis).METHOD(gp_Cylinder, Radius);
  CLASS(TopLoc_Location).constructor<>().constructor<const gp_Trsf&>()
    .COPY_GET(TopLoc_Location, Transformation).METHOD(TopLoc_Location, Multiplied);
  CLASS(TopoDS_Shape).constructor<>().METHOD(TopoDS_Shape, IsNull).METHOD(TopoDS_Shape, IsSame)
    .function("Orientation", select_overload<TopAbs_Orientation() const>(&TopoDS_Shape::Orientation));
  DERIVED(TopoDS_Edge, TopoDS_Shape);
  DERIVED(TopoDS_Face, TopoDS_Shape);
  DERIVED(TopoDS_Solid, TopoDS_Shape);
  DERIVED(TopoDS_Compound, TopoDS_Shape).constructor<>();
  CLASS(TopoDS)
    .class_function("Edge", +[](const TopoDS_Shape& shape) { return TopoDS::Edge(shape); })
    .class_function("Face", +[](const TopoDS_Shape& shape) { return TopoDS::Face(shape); })
    .class_function("Solid", +[](const TopoDS_Shape& shape) { return TopoDS::Solid(shape); });
  CLASS(TopoDS_Builder).constructor<>().METHOD(TopoDS_Builder, MakeCompound).METHOD(TopoDS_Builder, Add);
  CLASS(TopExp_Explorer).constructor<const TopoDS_Shape&, TopAbs_ShapeEnum, TopAbs_ShapeEnum>()
    .METHOD(TopExp_Explorer, More).METHOD(TopExp_Explorer, Next).COPY_GET(TopExp_Explorer, Current);
  enum_<TopAbs_ShapeEnum>("TopAbs_ShapeEnum").ENUM_VALUE(TopAbs_COMPOUND).ENUM_VALUE(TopAbs_COMPSOLID)
    .ENUM_VALUE(TopAbs_SOLID).ENUM_VALUE(TopAbs_SHELL).ENUM_VALUE(TopAbs_FACE).ENUM_VALUE(TopAbs_WIRE)
    .ENUM_VALUE(TopAbs_EDGE).ENUM_VALUE(TopAbs_VERTEX).ENUM_VALUE(TopAbs_SHAPE);
  enum_<TopAbs_Orientation>("TopAbs_Orientation").ENUM_VALUE(TopAbs_FORWARD).ENUM_VALUE(TopAbs_REVERSED)
    .ENUM_VALUE(TopAbs_INTERNAL).ENUM_VALUE(TopAbs_EXTERNAL);
  enum_<GeomAbs_CurveType>("GeomAbs_CurveType").ENUM_VALUE(GeomAbs_Line).ENUM_VALUE(GeomAbs_Circle)
    .ENUM_VALUE(GeomAbs_Ellipse).ENUM_VALUE(GeomAbs_Hyperbola).ENUM_VALUE(GeomAbs_Parabola)
    .ENUM_VALUE(GeomAbs_BezierCurve).ENUM_VALUE(GeomAbs_BSplineCurve).ENUM_VALUE(GeomAbs_OffsetCurve)
    .ENUM_VALUE(GeomAbs_OtherCurve);
  enum_<GeomAbs_SurfaceType>("GeomAbs_SurfaceType").ENUM_VALUE(GeomAbs_Plane).ENUM_VALUE(GeomAbs_Cylinder)
    .ENUM_VALUE(GeomAbs_Cone).ENUM_VALUE(GeomAbs_Sphere).ENUM_VALUE(GeomAbs_Torus)
    .ENUM_VALUE(GeomAbs_BezierSurface).ENUM_VALUE(GeomAbs_BSplineSurface).ENUM_VALUE(GeomAbs_SurfaceOfRevolution)
    .ENUM_VALUE(GeomAbs_SurfaceOfExtrusion).ENUM_VALUE(GeomAbs_OffsetSurface).ENUM_VALUE(GeomAbs_OtherSurface);
  CLASS(BRepPrimAPI_MakeBox)
    .constructor(+[](const val& placement, double x, double y, double z) {
      if (placement.instanceof(val::module_property("gp_Ax2"))) {
        return new BRepPrimAPI_MakeBox(placement.as<gp_Ax2>(), x, y, z);
      }
      return new BRepPrimAPI_MakeBox(placement.as<gp_Pnt>(), x, y, z);
    })
    .COPY_GET(BRepPrimAPI_MakeBox, Solid).BUILDER(BRepPrimAPI_MakeBox);
  CLASS(BRepPrimAPI_MakeCylinder).constructor<const gp_Ax2&, double, double>().BUILDER(BRepPrimAPI_MakeCylinder);
  CLASS(BRepPrimAPI_MakePrism).constructor<const TopoDS_Shape&, const gp_Vec&, bool, bool>().BUILDER(BRepPrimAPI_MakePrism);
  BOOLEAN(BRepAlgoAPI_Cut);
  BOOLEAN(BRepAlgoAPI_Fuse);
  BOOLEAN(BRepAlgoAPI_Common);
  CLASS(BRepBuilderAPI_Transform).constructor<const TopoDS_Shape&, const gp_Trsf&, bool, bool>()
    .BUILDER(BRepBuilderAPI_Transform);
  CLASS(BRepCheck_Analyzer).constructor<const TopoDS_Shape&, bool, bool, bool>()
    .function("IsValid", select_overload<bool() const>(&BRepCheck_Analyzer::IsValid));
  enum_<ChFi3d_FilletShape>("ChFi3d_FilletShape").ENUM_VALUE(ChFi3d_Rational)
    .ENUM_VALUE(ChFi3d_QuasiAngular).ENUM_VALUE(ChFi3d_Polynomial);
  CLASS(BRepFilletAPI_MakeFillet).constructor<const TopoDS_Shape&, ChFi3d_FilletShape>()
    .function("Add", select_overload<void(double, const TopoDS_Edge&)>(&BRepFilletAPI_MakeFillet::Add))
    .METHOD(BRepFilletAPI_MakeFillet, Build).BUILDER(BRepFilletAPI_MakeFillet);
  CLASS(BRepFilletAPI_MakeChamfer).constructor<const TopoDS_Shape&>()
    .function("Add", select_overload<void(double, const TopoDS_Edge&)>(&BRepFilletAPI_MakeChamfer::Add))
    .METHOD(BRepFilletAPI_MakeChamfer, Build).BUILDER(BRepFilletAPI_MakeChamfer);
  CLASS(TopTools_ListOfShape).constructor<>().function("Append", +[](TopTools_ListOfShape& list, const TopoDS_Shape& shape) {
    list.Append(shape);
  });
  CLASS(BRepOffsetAPI_MakeThickSolid).constructor<>().METHOD(BRepOffsetAPI_MakeThickSolid, MakeThickSolidBySimple)
    .function("MakeThickSolidByJoin", +[](BRepOffsetAPI_MakeThickSolid& maker, const TopoDS_Shape& shape,
                                         const TopTools_ListOfShape& removed, double thickness, double tolerance,
                                         const Message_ProgressRange& progress) {
      maker.MakeThickSolidByJoin(shape, removed, thickness, tolerance, BRepOffset_Skin,
                                 false, false, GeomAbs_Arc, false, progress);
    })
    .BUILDER(BRepOffsetAPI_MakeThickSolid);
  CLASS(BRepExtrema_DistShapeShape).constructor<const TopoDS_Shape&, const TopoDS_Shape&>()
    .METHOD(BRepExtrema_DistShapeShape, IsDone).METHOD(BRepExtrema_DistShapeShape, Value)
    .METHOD(BRepExtrema_DistShapeShape, InnerSolution);
  CLASS(Bnd_Box).constructor<>().METHOD(Bnd_Box, CornerMin).METHOD(Bnd_Box, CornerMax);
  CLASS(BRepBndLib).class_function("AddOptimal", &BRepBndLib::AddOptimal);
  CLASS(GProp_GProps).constructor<>().METHOD(GProp_GProps, Mass).METHOD(GProp_GProps, CentreOfMass);
  CLASS(BRepGProp)
    .class_function("VolumeProperties", select_overload<void(const TopoDS_Shape&, GProp_GProps&, bool, bool, bool)>(&BRepGProp::VolumeProperties))
    .class_function("SurfaceProperties", select_overload<void(const TopoDS_Shape&, GProp_GProps&, bool, bool)>(&BRepGProp::SurfaceProperties));
  CLASS(Precision).class_function("Confusion", &Precision::Confusion);
  CLASS(BRepAdaptor_Curve).constructor<const TopoDS_Edge&>().METHOD(BRepAdaptor_Curve, GetType)
    .METHOD(BRepAdaptor_Curve, FirstParameter).METHOD(BRepAdaptor_Curve, LastParameter)
    .METHOD(BRepAdaptor_Curve, Circle)
    .function("EvalD0", &BRepAdaptor_Curve::Value);
  value_object<SurfaceD1>("SurfaceD1").field("Point", &SurfaceD1::Point)
    .field("D1U", &SurfaceD1::D1U).field("D1V", &SurfaceD1::D1V);
  CLASS(BRepAdaptor_Surface).constructor<const TopoDS_Face&, bool>().METHOD(BRepAdaptor_Surface, GetType)
    .METHOD(BRepAdaptor_Surface, Plane).METHOD(BRepAdaptor_Surface, Cylinder)
    .METHOD(BRepAdaptor_Surface, FirstUParameter).METHOD(BRepAdaptor_Surface, LastUParameter)
    .METHOD(BRepAdaptor_Surface, FirstVParameter).METHOD(BRepAdaptor_Surface, LastVParameter)
    .function("EvalD1", +[](const BRepAdaptor_Surface& surface, double u, double v) {
      SurfaceD1 result;
      surface.D1(u, v, result.Point, result.D1U, result.D1V);
      return result;
    });
  CLASS(BRepMesh_IncrementalMesh).constructor<const TopoDS_Shape&, double, bool, double, bool>()
    .function("IsDone", +[](BRepMesh_IncrementalMesh& mesh) { return mesh.IsDone(); });
  CLASS(Poly_Triangle).METHOD(Poly_Triangle, Value);
  CLASS(Poly_Triangulation).smart_ptr<Handle(Poly_Triangulation)>("Handle_Poly_Triangulation")
    .METHOD(Poly_Triangulation, NbNodes).METHOD(Poly_Triangulation, NbTriangles)
    .METHOD(Poly_Triangulation, Node).METHOD(Poly_Triangulation, HasNormals)
    .METHOD(Poly_Triangulation, ComputeNormals)
    .function("Normal", select_overload<gp_Dir(int) const>(&Poly_Triangulation::Normal))
    .function("Triangle", +[](const Poly_Triangulation& mesh, int index) { return mesh.Triangle(index); });
  CLASS(BRep_Tool).class_function("Degenerated", &BRep_Tool::Degenerated)
    .class_function("Triangulation", +[](const TopoDS_Face& face, TopLoc_Location& location, unsigned int purpose) {
      return BRep_Tool::Triangulation(face, location, static_cast<Poly_MeshPurpose>(purpose));
    });
  CLASS(BRepLib).class_function("BuildCurves3d", select_overload<bool(const TopoDS_Shape&)>(&BRepLib::BuildCurves3d));
  CLASS(HLRAlgo_Projector).constructor<const gp_Ax2&>();
  class_<HlrAlgorithm>("HLRBRep_Algo").constructor<>().METHOD(HlrAlgorithm, Projector)
    .METHOD(HlrAlgorithm, Add).METHOD(HlrAlgorithm, Update).METHOD(HlrAlgorithm, Hide);
  CLASS(HLRBRep_HLRToShape)
    .constructor(+[](const HlrAlgorithm& algo) { return new HLRBRep_HLRToShape(algo.impl); })
    .function("VCompound", +[](HLRBRep_HLRToShape& result) { return result.VCompound(); })
    .function("HCompound", +[](HLRBRep_HLRToShape& result) { return result.HCompound(); })
    .function("OutLineVCompound", +[](HLRBRep_HLRToShape& result) { return result.OutLineVCompound(); })
    .function("OutLineHCompound", +[](HLRBRep_HLRToShape& result) { return result.OutLineHCompound(); })
    .function("Rg1LineVCompound", +[](HLRBRep_HLRToShape& result) { return result.Rg1LineVCompound(); })
    .function("Rg1LineHCompound", +[](HLRBRep_HLRToShape& result) { return result.Rg1LineHCompound(); });
  enum_<IFSelect_ReturnStatus>("IFSelect_ReturnStatus").ENUM_VALUE(IFSelect_RetVoid).ENUM_VALUE(IFSelect_RetDone)
    .ENUM_VALUE(IFSelect_RetError).ENUM_VALUE(IFSelect_RetFail).ENUM_VALUE(IFSelect_RetStop);
  enum_<STEPControl_StepModelType>("STEPControl_StepModelType").ENUM_VALUE(STEPControl_AsIs);
  CLASS(STEPControl_Writer).constructor<>()
    .function("Transfer", +[](STEPControl_Writer& writer, const TopoDS_Shape& shape, STEPControl_StepModelType mode,
                              bool graph, const Message_ProgressRange& progress) {
      return writer.Transfer(shape, mode, graph, progress);
    })
    .function("Write", +[](STEPControl_Writer& writer, const std::string& path) { return writer.Write(path.c_str()); });
  CLASS(STEPControl_Reader).constructor<>()
    .function("ReadFile", +[](STEPControl_Reader& reader, const std::string& path) { return reader.ReadFile(path.c_str()); })
    .function("TransferRoots", +[](STEPControl_Reader& reader, const Message_ProgressRange& progress) { return reader.TransferRoots(progress); })
    .METHOD(STEPControl_Reader, NbRootsForTransfer).COPY_GET(STEPControl_Reader, OneShape);
}
