// SPDX-License-Identifier: MIT
// Narrow product ABI. OCCT retains its original license and exception.
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRep_Tool.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <STEPControl_Writer.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Controller.hxx>
#include <Interface_Static.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Standard_Failure.hxx>
#include <Precision.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <cmath>
#include <algorithm>
#include <cstdio>

static bool validate_geometry(const TopoDS_Shape& shape, double D, double d, double L) {
 if(shape.IsNull() || !BRepCheck_Analyzer(shape).IsValid()) return false;
 int solids=0, shells=0, faces=0, planes=0, cylinders=0;
 TopoDS_Shape solid;
 for(TopExp_Explorer ex(shape,TopAbs_SOLID);ex.More();ex.Next()){solid=ex.Current();++solids;}
 for(TopExp_Explorer ex(shape,TopAbs_SHELL);ex.More();ex.Next()){
  ++shells;if(!BRep_Tool::IsClosed(ex.Current()))return false;
 }
 if(solids!=1 || shells!=1)return false;
 double radii[2]={0,0};
 for(TopExp_Explorer ex(shape,TopAbs_FACE);ex.More();ex.Next()){
  ++faces;BRepAdaptor_Surface surface(TopoDS::Face(ex.Current()),true);
  if(surface.GetType()==GeomAbs_Cylinder){if(cylinders>=2)return false;radii[cylinders++]=surface.Cylinder().Radius();}
  else if(surface.GetType()==GeomAbs_Plane)++planes;
  else return false;
 }
 if(faces!=4||planes!=2||cylinders!=2)return false;
 std::sort(radii,radii+2);
 if(std::abs(radii[0]-d/2)>=1e-6||std::abs(radii[1]-D/2)>=1e-6)return false;
 GProp_GProps props;BRepGProp::VolumeProperties(shape,props,true,false,false);
 double volume=props.Mass(), expected=std::acos(-1.0)*(D-d)*(D+d)*L/4;
 if(!std::isfinite(volume)||volume<=0||std::abs(volume-expected)>std::max(1e-6,expected*1e-9))return false;
 auto point=[&](double x,double y,bool inside){
  auto vertex=BRepBuilderAPI_MakeVertex(gp_Pnt(x,y,0)).Shape();
  BRepExtrema_DistShapeShape distance(solid,vertex);
  return distance.IsDone() && distance.InnerSolution()==inside && std::abs(distance.Value()-(inside?0:d/2))<=1e-6;
 };
 for(double x:{-0.49*L,0.0,0.49*L})if(!point(x,0,false))return false;
 return point(0,(d+D)/4,true);
}
extern "C" int spacer_step(double outer,double inner,double height){
 // A repeated call may never expose a stale successful output after failure.
 std::remove("/spacer.step");
 if(!std::isfinite(outer)||!std::isfinite(inner)||!std::isfinite(height)
  ||inner<=2*Precision::Confusion()||outer-inner<=2*Precision::Confusion()
  ||height<=2*Precision::Confusion())return 2;
 try{
  gp_Ax2 axis(gp_Pnt(-height/2,0,0),gp_Dir(1,0,0));
  BRepPrimAPI_MakeCylinder outerCylinder(axis,outer/2,height),innerCylinder(axis,inner/2,height);
  const auto a=outerCylinder.Shape(),b=innerCylinder.Shape();
  if(!outerCylinder.IsDone()||!innerCylinder.IsDone())return 3;
  BRepAlgoAPI_Cut cut(a,b);
  if(!cut.IsDone()||!validate_geometry(cut.Shape(),outer,inner,height))return 4;
  STEPControl_Controller::Init();
  for(auto setting:{std::pair<const char*,const char*>("write.step.schema","AP214IS"),{"write.step.unit","MM"},{"xstep.cascade.unit","MM"}}){
   if(!Interface_Static::SetCVal(setting.first,setting.second))return 11;
   if(std::string(Interface_Static::CVal(setting.first))!=setting.second)return 11;
  }
  if(Interface_Static::IVal("write.step.schema")!=4)return 11;
  STEPControl_Writer writer;
  if(writer.Transfer(cut.Shape(),STEPControl_AsIs)!=IFSelect_RetDone)return 5;
  if(writer.Write("/spacer.step")!=IFSelect_RetDone)return 6;
  STEPControl_Reader reader;
  if(reader.ReadFile("/spacer.step")!=IFSelect_RetDone)return 7;
  if(reader.TransferRoots()!=1||!validate_geometry(reader.OneShape(),outer,inner,height))return 8;
  return 0;
 }catch(const Standard_Failure&){return 9;}catch(...){return 10;}
}
