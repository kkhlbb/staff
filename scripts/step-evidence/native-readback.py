"""Evidence-only native OCP reader. Usage: python -B native-readback.py file.step report.json dQ DQ LQ
OCP is separately installed for acceptance, never a product dependency. No explicit repair API.
"""
import sys,json,io,re,math,hashlib
from pathlib import Path
from decimal import Decimal,localcontext
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone,IFSelect_ItemsByEntity
from OCP.collections import Sequence_TCollection_AsciiString
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID,TopAbs_SHELL,TopAbs_FACE,TopAbs_OUT,TopAbs_IN,TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder,GeomAbs_Plane
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.gp import gp_Pnt,gp_Dir,gp_Ax2
class Reject(Exception): pass
def need(v,msg):
 if not v: raise Reject(msg)
def collect(shape,kind):
 e=TopExp_Explorer(shape,kind);a=[]
 while e.More(): a.append(e.Current());e.Next()
 return a
def printed(method):
 s=io.BytesIO();method(s,False,IFSelect_ItemsByEntity);return s.getvalue().decode(errors='replace')
def checks(it):
 a=[];it.Start()
 while it.More():
  c=it.Value();a.append({'entity':it.Number(),'warnings':[c.CWarning(i) for i in range(1,c.NbWarnings()+1)],'fails':[c.CFail(i) for i in range(1,c.NbFails()+1)]});it.Next()
 return a
def oracle(q):
 with localcontext() as ctx:
  ctx.prec=60;a=Decimal(1);b=1/Decimal(2).sqrt();t=Decimal(1)/4;p=Decimal(1)
  for _ in range(8):
   n=(a+b)/2;b=(a*b).sqrt();t-=p*(a-n)**2;a=n;p*=2
  pi=(a+b)**2/(4*t);d,D,L=[Decimal(x)/10000 for x in q]
  return {'q':q,'d':str(d),'D':str(D),'L':str(L),'pi':str(pi),'volume':str(pi*(D-d)*(D+d)*L/4),'bbox':list(map(str,[-L/2,-D/2,-D/2,L/2,D/2,D/2]))}
def main():
 target,out=map(Path,sys.argv[1:3]);q=list(map(int,sys.argv[3:6]));ref=oracle(q);d,D,L=[float(ref[k]) for k in ['d','D','L']]
 raw=target.read_bytes();sha=hashlib.sha256(raw).hexdigest();report={'fileName':target.name,'sha256':sha,'oracle':ref,'linearThresholdMm':1e-6,'repairFreeImportProven':False,'scope':'Native OCP/OCCT 8.0.1, same kernel family; not second-vendor interoperability; default transfer may heal internally.'}
 try:
  r=STEPControl_Reader();status=r.ReadFile(str(target));report['readStatus']=str(status);need(status==IFSelect_RetDone,'ReadFile rejected')
  h=io.BytesIO();r.StepModel().DumpHeader(h);report['nativeHeader']=h.getvalue().decode(errors='replace')
  need(bool(re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'AUTOMOTIVE_DESIGN \{ 1 0 10303 214 1 1 1 1 \}'",report['nativeHeader'])),'schema mismatch')
  need(bool(re.search(rb"APPLICATION_PROTOCOL_DEFINITION\('international standard',\s*'automotive_design',2000,",raw)),'AP declaration mismatch')
  seq=[Sequence_TCollection_AsciiString() for _ in range(3)];r.FileUnits(*seq);units=[[s.Value(i).ToCString() for i in range(1,s.Length()+1)] for s in seq];report['sourceUnits']=units
  need(bool(units[0]) and all(s.lower() in {'millimetre','millimeter','mm'} for s in units[0]),'source unit policy rejects non-mm')
  r.SetSystemLengthUnit(1.0)
  try:report['shapeProcessFlags']=str(r.GetShapeProcessFlags())
  except Exception as e:report['shapeProcessFlagsUnobservable']=repr(e)
  roots=r.NbRootsForTransfer();transferred=r.TransferRoots();report.update(roots=roots,transferred=transferred,shapeCount=r.NbShapes())
  report['loadPrinted']=printed(r.PrintCheckLoad);report['transferPrinted']=printed(r.PrintCheckTransfer);report['loadChecks']=checks(r.WS().ModelCheckList());report['transferChecks']=checks(r.WS().TransferReader().TransientProcess().CheckList(False))
  need(not any(c['fails'] for c in report['loadChecks']+report['transferChecks']),'native diagnostics failure')
  need(roots==transferred==r.NbShapes()==1,'root count')
  s=r.OneShape();need(not s.IsNull(),'null');valid=BRepCheck_Analyzer(s).IsValid();need(valid,'invalid B-rep')
  solids,shells,faces=[collect(s,k) for k in [TopAbs_SOLID,TopAbs_SHELL,TopAbs_FACE]];report.update(valid=valid,solidCount=len(solids),shellCount=len(shells),faceCount=len(faces));need(len(solids)==len(shells)==1,'solid/shell count')
  closed=BRep_Tool.IsClosed_s(shells[0]);report['closed']=closed;need(closed,'open shell')
  radii=[];planes=[];surfaces=[]
  for f in faces:
   surf=BRepAdaptor_Surface(TopoDS.Face(f));kind=surf.GetType()
   if kind==GeomAbs_Cylinder:
    c=surf.Cylinder();a=c.Axis();v=a.Direction();p=a.Location();radii.append(c.Radius());surfaces.append({'type':'cylinder','radius':c.Radius(),'orientation':str(f.Orientation())})
    need(abs(abs(v.X())-1)<=1e-6 and abs(v.Y())<=1e-6 and abs(v.Z())<=1e-6,'axis not X');need(abs(p.Y())<=1e-6 and abs(p.Z())<=1e-6,'not coaxial')
    if abs(c.Radius()-d/2)<=1e-6:need(f.Orientation()==TopAbs_REVERSED,'inner face orientation')
   elif kind==GeomAbs_Plane:
    p=surf.Plane().Location();v=surf.Plane().Axis().Direction();planes.append(p.X());surfaces.append({'type':'plane','x':p.X()});need(abs(abs(v.X())-1)<=1e-6 and abs(v.Y())<=1e-6 and abs(v.Z())<=1e-6,'plane normal')
   else:raise Reject('non-analytic face')
  report['surfaces']=surfaces;report['radiiMm']=sorted(radii)
  need(len(faces)==4 and len(radii)==len(planes)==2,'face topology')
  need(all(abs(a-b)<=1e-6 for a,b in zip(sorted(radii),[d/2,D/2])),'radius mismatch');need(all(abs(a-b)<=1e-6 for a,b in zip(sorted(planes),[-L/2,L/2])),'end planes mismatch')
  box=Bnd_Box();BRepBndLib.AddOptimal_s(s,box,False,False);lo=box.CornerMin();hi=box.CornerMax();bbox=[lo.X(),lo.Y(),lo.Z(),hi.X(),hi.Y(),hi.Z()];report['bboxMm']=bbox
  need(all(math.isfinite(a) and abs(a-float(b))<=1e-6 for a,b in zip(bbox,ref['bbox'])),'bbox mismatch')
  prop=GProp_GProps();BRepGProp.VolumeProperties_s(s,prop);volume=prop.Mass();report['volumeMm3']=volume
  with localcontext() as ctx:
   ctx.prec=70;v=Decimal(ref['volume']);err=abs(Decimal.from_float(volume)-v);tol=max(Decimal('1e-6'),abs(v)*Decimal('1e-9'));report.update(volumeErrorMm3=str(err),volumeThresholdMm3=str(tol));need(math.isfinite(volume) and volume>0 and err<=tol,'volume mismatch')
  points=[]
  for p,expected in [((-L*.49,0,0),TopAbs_OUT),((0,0,0),TopAbs_OUT),((L*.49,0,0),TopAbs_OUT),((0,(d+D)/4,0),TopAbs_IN)]:
   state=BRepClass3d_SolidClassifier(s,gp_Pnt(*p),1e-7).State();points.append({'point':p,'state':str(state)});need(state==expected,'hole/material mismatch')
  report['pointClassifications']=points
  probes=[];pr=min((D-d)/8,L/8);ph=L/4
  for label,origin,radius,height,count,expectedV in [('core',(-L,0,0),d*.45,2*L,0,0),('material',(-ph/2,(d+D)/4,0),pr,ph,1,math.pi*pr*pr*ph)]:
   tool=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*origin),gp_Dir(1,0,0)),radius,height).Shape();common=BRepAlgoAPI_Common(s,tool);common.Build();need(common.IsDone(),'Boolean failed');s2=common.Shape();p=GProp_GProps();BRepGProp.VolumeProperties_s(s2,p);n=len(collect(s2,TopAbs_SOLID));valid=BRepCheck_Analyzer(s2).IsValid();probes.append({'label':label,'solidCount':n,'volume':p.Mass(),'valid':valid});need(valid and n==count and abs(p.Mass()-expectedV)<=max(1e-6,expectedV*1e-9),'Boolean probe mismatch')
  report['booleanProbes']=probes;report['status']='ACCEPTED';code=0
 except Reject as e:report.update(status='REJECTED',reason=str(e));code=3
 except Exception as e:report.update(status='HARNESS_ERROR',reason=repr(e));code=1
 need(hashlib.sha256(target.read_bytes()).hexdigest()==sha,'source changed')
 with out.open('x') as f:json.dump(report,f,indent=2)
 print(json.dumps(report,indent=2));return code
if __name__=='__main__':sys.exit(main())
