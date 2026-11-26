// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    namespace FS {
        export let root: any;
        export let mounts: any[];
        export let devices: {};
        export let streams: any[];
        export let nextInode: number;
        export let nameTable: any;
        export let currentPath: string;
        export let initialized: boolean;
        export let ignorePermissions: boolean;
        export let filesystems: any;
        export let syncFSRequests: number;
        export let readFiles: {};
        export { ErrnoError };
        export { FSStream };
        export { FSNode };
        export function lookupPath(path: any, opts?: {}): {
            path: string;
            node?: undefined;
        } | {
            path: string;
            node: any;
        };
        export function getPath(node: any): any;
        export function hashName(parentid: any, name: any): number;
        export function hashAddNode(node: any): void;
        export function hashRemoveNode(node: any): void;
        export function lookupNode(parent: any, name: any): any;
        export function createNode(parent: any, name: any, mode: any, rdev: any): any;
        export function destroyNode(node: any): void;
        export function isRoot(node: any): boolean;
        export function isMountpoint(node: any): boolean;
        export function isFile(mode: any): boolean;
        export function isDir(mode: any): boolean;
        export function isLink(mode: any): boolean;
        export function isChrdev(mode: any): boolean;
        export function isBlkdev(mode: any): boolean;
        export function isFIFO(mode: any): boolean;
        export function isSocket(mode: any): boolean;
        export function flagsToPermissionString(flag: any): string;
        export function nodePermissions(node: any, perms: any): 0 | 2;
        export function mayLookup(dir: any): any;
        export function mayCreate(dir: any, name: any): any;
        export function mayDelete(dir: any, name: any, isdir: any): any;
        export function mayOpen(node: any, flags: any): any;
        export function checkOpExists(op: any, err: any): any;
        export let MAX_OPEN_FDS: number;
        export function nextfd(): number;
        export function getStreamChecked(fd: any): any;
        export function getStream(fd: any): any;
        export function createStream(stream: any, fd?: number): any;
        export function closeStream(fd: any): void;
        export function dupStream(origStream: any, fd?: number): any;
        export function doSetAttr(stream: any, node: any, attr: any): void;
        export namespace chrdev_stream_ops {
            function open(stream: any): void;
            function llseek(): never;
        }
        export function major(dev: any): number;
        export function minor(dev: any): number;
        export function makedev(ma: any, mi: any): number;
        export function registerDevice(dev: any, ops: any): void;
        export function getDevice(dev: any): any;
        export function getMounts(mount: any): any[];
        export function syncfs(populate: any, callback: any): void;
        export function mount(type: any, opts: any, mountpoint: any): any;
        export function unmount(mountpoint: any): void;
        export function lookup(parent: any, name: any): any;
        export function mknod(path: any, mode: any, dev: any): any;
        export function statfs(path: any): any;
        export function statfsStream(stream: any): any;
        export function statfsNode(node: any): {
            bsize: number;
            frsize: number;
            blocks: number;
            bfree: number;
            bavail: number;
            files: any;
            ffree: number;
            fsid: number;
            flags: number;
            namelen: number;
        };
        export function create(path: any, mode?: number): any;
        export function mkdir(path: any, mode?: number): any;
        export function mkdirTree(path: any, mode: any): void;
        export function mkdev(path: any, mode: any, dev: any): any;
        export function symlink(oldpath: any, newpath: any): any;
        export function rename(old_path: any, new_path: any): void;
        export function rmdir(path: any): void;
        export function readdir(path: any): any;
        export function unlink(path: any): void;
        export function readlink(path: any): any;
        export function stat(path: any, dontFollow: any): any;
        export function fstat(fd: any): any;
        export function lstat(path: any): any;
        export function doChmod(stream: any, node: any, mode: any, dontFollow: any): void;
        export function chmod(path: any, mode: any, dontFollow: any): void;
        export function lchmod(path: any, mode: any): void;
        export function fchmod(fd: any, mode: any): void;
        export function doChown(stream: any, node: any, dontFollow: any): void;
        export function chown(path: any, uid: any, gid: any, dontFollow: any): void;
        export function lchown(path: any, uid: any, gid: any): void;
        export function fchown(fd: any, uid: any, gid: any): void;
        export function doTruncate(stream: any, node: any, len: any): void;
        export function truncate(path: any, len: any): void;
        export function ftruncate(fd: any, len: any): void;
        export function utime(path: any, atime: any, mtime: any): void;
        export function open(path: any, flags: any, mode?: number): any;
        export function close(stream: any): void;
        export function isClosed(stream: any): boolean;
        export function llseek(stream: any, offset: any, whence: any): any;
        export function read(stream: any, buffer: any, offset: any, length: any, position: any): any;
        export function write(stream: any, buffer: any, offset: any, length: any, position: any, canOwn: any): any;
        export function mmap(stream: any, length: any, position: any, prot: any, flags: any): any;
        export function msync(stream: any, buffer: any, offset: any, length: any, mmapFlags: any): any;
        export function ioctl(stream: any, cmd: any, arg: any): any;
        export function readFile(path: any, opts?: {}): Uint8Array<any>;
        export function writeFile(path: any, data: any, opts?: {}): void;
        export function cwd(): any;
        export function chdir(path: any): void;
        export function createDefaultDirectories(): void;
        export function createDefaultDevices(): void;
        export function createSpecialDirectories(): void;
        export function createStandardStreams(input: any, output: any, error: any): void;
        export function staticInit(): void;
        export function init(input: any, output: any, error: any): void;
        export function quit(): void;
        export function findObject(path: any, dontResolveLastLink: any): any;
        export function analyzePath(path: any, dontResolveLastLink: any): {
            isRoot: boolean;
            exists: boolean;
            error: number;
            name: any;
            path: any;
            object: any;
            parentExists: boolean;
            parentPath: any;
            parentObject: any;
        };
        export function createPath(parent: any, path: any, canRead: any, canWrite: any): any;
        export function createFile(parent: any, name: any, properties: any, canRead: any, canWrite: any): any;
        export function createDataFile(parent: any, name: any, data: any, canRead: any, canWrite: any, canOwn: any): void;
        export function createDevice(parent: any, name: any, input: any, output: any): any;
        export function forceLoadFile(obj: any): boolean;
        export function createLazyFile(parent: any, name: any, url: any, canRead: any, canWrite: any): any;
        export function absolutePath(): void;
        export function createFolder(): void;
        export function createLink(): void;
        export function joinPath(): void;
        export function mmapAlloc(): void;
        export function standardizePath(): void;
    }
    let wasmMemory: any;
    function getExceptionMessage(ex: any): any;
    function decrementExceptionRefcount(ex: any): void;
    function FS_createPath(...args: any[]): any;
    function FS_createDataFile(...args: any[]): any;
    function FS_preloadFile(parent: any, name: any, url: any, canRead: any, canWrite: any, dontCreateFile: any, canOwn: any, preFinish: any): Promise<void>;
    function FS_unlink(...args: any[]): any;
    function FS_createLazyFile(...args: any[]): any;
    function FS_createDevice(...args: any[]): any;
    function addRunDependency(id: any): void;
    function removeRunDependency(id: any): void;
}
declare class ErrnoError extends Error {
    constructor(errno: any);
    errno: any;
    code: string;
}
declare class FSStream {
    shared: {};
    set object(val: any);
    get object(): any;
    node: any;
    get isRead(): boolean;
    get isWrite(): boolean;
    get isAppend(): number;
    set flags(val: any);
    get flags(): any;
    set position(val: any);
    get position(): any;
}
declare class FSNode {
    constructor(parent: any, name: any, mode: any, rdev: any);
    node_ops: {};
    stream_ops: {};
    readMode: number;
    writeMode: number;
    mounted: any;
    parent: any;
    mount: any;
    id: number;
    name: any;
    mode: any;
    rdev: any;
    atime: number;
    mtime: number;
    ctime: number;
    set read(val: boolean);
    get read(): boolean;
    set write(val: boolean);
    get write(): boolean;
    get isFolder(): any;
    get isDevice(): any;
}
interface WasmModule {
  _spacer_step(_0: number, _1: number, _2: number): number;
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
export interface ClassHandle {
  isAliasOf(other: ClassHandle): boolean;
  delete(): void;
  deleteLater(): this;
  isDeleted(): boolean;
  // @ts-ignore - If targeting lower than ESNext, this symbol might not exist.
  [Symbol.dispose](): void;
  clone(): this;
}
export interface Message_ProgressRange extends ClassHandle {
}

export interface gp_Trsf extends ClassHandle {
  Value(_0: number, _1: number): number;
  SetValues(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number, _11: number): void;
  SetRotation(_0: gp_Ax1, _1: number): void;
}

export interface gp_Pnt extends ClassHandle {
  Transform(_0: gp_Trsf): void;
  X(): number;
  Y(): number;
  Z(): number;
}

export interface gp_Dir extends ClassHandle {
  Transformed(_0: gp_Trsf): gp_Dir;
  Transform(_0: gp_Trsf): void;
  X(): number;
  Y(): number;
  Z(): number;
}

export interface gp_Vec extends ClassHandle {
  Transform(_0: gp_Trsf): void;
  X(): number;
  Y(): number;
  Z(): number;
}

export interface gp_Ax1 extends ClassHandle {
  Location(): gp_Pnt;
  Direction(): gp_Dir;
}

export interface gp_Ax2 extends ClassHandle {
}

export interface gp_Pln extends ClassHandle {
  Axis(): gp_Ax1;
  Location(): gp_Pnt;
}

export interface gp_Circ extends ClassHandle {
  Axis(): gp_Ax1;
  Radius(): number;
}

export interface gp_Cylinder extends ClassHandle {
  Axis(): gp_Ax1;
  Radius(): number;
}

export interface TopLoc_Location extends ClassHandle {
  Transformation(): gp_Trsf;
  Multiplied(_0: TopLoc_Location): TopLoc_Location;
}

export interface TopoDS_Shape extends ClassHandle {
  Orientation(): TopAbs_Orientation;
  IsNull(): boolean;
  IsSame(_0: TopoDS_Shape): boolean;
}

export interface TopoDS_Edge extends TopoDS_Shape {
}

export interface TopoDS_Face extends TopoDS_Shape {
}

export interface TopoDS_Solid extends TopoDS_Shape {
}

export interface TopoDS_Compound extends TopoDS_Shape {
}

export interface TopoDS extends ClassHandle {
}

export interface TopoDS_Builder extends ClassHandle {
  MakeCompound(_0: TopoDS_Compound): void;
  Add(_0: TopoDS_Shape, _1: TopoDS_Shape): void;
}

export interface TopExp_Explorer extends ClassHandle {
  Current(): TopoDS_Shape;
  Next(): void;
  More(): boolean;
}

export interface TopAbs_ShapeEnumValue<T extends number> {
  value: T;
}
export type TopAbs_ShapeEnum = TopAbs_ShapeEnumValue<0>|TopAbs_ShapeEnumValue<1>|TopAbs_ShapeEnumValue<2>|TopAbs_ShapeEnumValue<3>|TopAbs_ShapeEnumValue<4>|TopAbs_ShapeEnumValue<5>|TopAbs_ShapeEnumValue<6>|TopAbs_ShapeEnumValue<7>|TopAbs_ShapeEnumValue<8>;

export interface TopAbs_OrientationValue<T extends number> {
  value: T;
}
export type TopAbs_Orientation = TopAbs_OrientationValue<0>|TopAbs_OrientationValue<1>|TopAbs_OrientationValue<2>|TopAbs_OrientationValue<3>;

export interface GeomAbs_CurveTypeValue<T extends number> {
  value: T;
}
export type GeomAbs_CurveType = GeomAbs_CurveTypeValue<0>|GeomAbs_CurveTypeValue<1>|GeomAbs_CurveTypeValue<2>|GeomAbs_CurveTypeValue<3>|GeomAbs_CurveTypeValue<4>|GeomAbs_CurveTypeValue<5>|GeomAbs_CurveTypeValue<6>|GeomAbs_CurveTypeValue<7>|GeomAbs_CurveTypeValue<8>;

export interface GeomAbs_SurfaceTypeValue<T extends number> {
  value: T;
}
export type GeomAbs_SurfaceType = GeomAbs_SurfaceTypeValue<0>|GeomAbs_SurfaceTypeValue<1>|GeomAbs_SurfaceTypeValue<2>|GeomAbs_SurfaceTypeValue<3>|GeomAbs_SurfaceTypeValue<4>|GeomAbs_SurfaceTypeValue<5>|GeomAbs_SurfaceTypeValue<6>|GeomAbs_SurfaceTypeValue<7>|GeomAbs_SurfaceTypeValue<8>|GeomAbs_SurfaceTypeValue<9>|GeomAbs_SurfaceTypeValue<10>;

export interface BRepPrimAPI_MakeBox extends ClassHandle {
  Solid(): TopoDS_Solid;
  Shape(): TopoDS_Shape;
  IsDone(): boolean;
}

export interface BRepPrimAPI_MakeCylinder extends ClassHandle {
  Shape(): TopoDS_Shape;
  IsDone(): boolean;
}

export interface BRepPrimAPI_MakePrism extends ClassHandle {
  Shape(): TopoDS_Shape;
  IsDone(): boolean;
}

export interface BRepAlgoAPI_Cut extends ClassHandle {
  Shape(): TopoDS_Shape;
  IsDone(): boolean;
  HasErrors(): boolean;
  SimplifyResult(_0: boolean, _1: boolean, _2: number): void;
}

export interface BRepAlgoAPI_Fuse extends ClassHandle {
  Shape(): TopoDS_Shape;
  IsDone(): boolean;
  HasErrors(): boolean;
  SimplifyResult(_0: boolean, _1: boolean, _2: number): void;
}

export interface BRepAlgoAPI_Common extends ClassHandle {
  Shape(): TopoDS_Shape;
  IsDone(): boolean;
  HasErrors(): boolean;
  SimplifyResult(_0: boolean, _1: boolean, _2: number): void;
}

export interface BRepBuilderAPI_Transform extends ClassHandle {
  Shape(): TopoDS_Shape;
  IsDone(): boolean;
}

export interface BRepCheck_Analyzer extends ClassHandle {
  IsValid(): boolean;
}

export interface ChFi3d_FilletShapeValue<T extends number> {
  value: T;
}
export type ChFi3d_FilletShape = ChFi3d_FilletShapeValue<0>|ChFi3d_FilletShapeValue<1>|ChFi3d_FilletShapeValue<2>;

export interface BRepFilletAPI_MakeFillet extends ClassHandle {
  Shape(): TopoDS_Shape;
  Build(_0: Message_ProgressRange): void;
  IsDone(): boolean;
  Add(_0: number, _1: TopoDS_Edge): void;
}

export interface BRepFilletAPI_MakeChamfer extends ClassHandle {
  Shape(): TopoDS_Shape;
  Build(_0: Message_ProgressRange): void;
  IsDone(): boolean;
  Add(_0: number, _1: TopoDS_Edge): void;
}

export interface TopTools_ListOfShape extends ClassHandle {
  Append(_0: TopoDS_Shape): void;
}

export interface BRepOffsetAPI_MakeThickSolid extends ClassHandle {
  Shape(): TopoDS_Shape;
  IsDone(): boolean;
  MakeThickSolidBySimple(_0: TopoDS_Shape, _1: number): void;
  MakeThickSolidByJoin(_0: TopoDS_Shape, _1: TopTools_ListOfShape, _2: number, _3: number, _4: Message_ProgressRange): void;
}

export interface BRepExtrema_DistShapeShape extends ClassHandle {
  IsDone(): boolean;
  InnerSolution(): boolean;
  Value(): number;
}

export interface Bnd_Box extends ClassHandle {
  CornerMin(): gp_Pnt;
  CornerMax(): gp_Pnt;
}

export interface BRepBndLib extends ClassHandle {
}

export interface GProp_GProps extends ClassHandle {
  CentreOfMass(): gp_Pnt;
  Mass(): number;
}

export interface BRepGProp extends ClassHandle {
}

export interface Precision extends ClassHandle {
}

export interface BRepAdaptor_Curve extends ClassHandle {
  GetType(): GeomAbs_CurveType;
  Circle(): gp_Circ;
  FirstParameter(): number;
  LastParameter(): number;
  EvalD0(_0: number): gp_Pnt;
}

export type SurfaceD1 = {
  Point: gp_Pnt,
  D1U: gp_Vec,
  D1V: gp_Vec
};

export interface BRepAdaptor_Surface extends ClassHandle {
  GetType(): GeomAbs_SurfaceType;
  Plane(): gp_Pln;
  Cylinder(): gp_Cylinder;
  FirstUParameter(): number;
  LastUParameter(): number;
  FirstVParameter(): number;
  LastVParameter(): number;
  EvalD1(_0: number, _1: number): SurfaceD1;
}

export interface BRepMesh_IncrementalMesh extends ClassHandle {
  IsDone(): boolean;
}

export interface Poly_Triangle extends ClassHandle {
  Value(_0: number): number;
}

export interface Poly_Triangulation extends ClassHandle {
  ComputeNormals(): void;
  HasNormals(): boolean;
  NbNodes(): number;
  NbTriangles(): number;
  Node(_0: number): gp_Pnt;
  Normal(_0: number): gp_Dir;
  Triangle(_0: number): Poly_Triangle;
}

export interface BRep_Tool extends ClassHandle {
}

export interface BRepLib extends ClassHandle {
}

export interface HLRAlgo_Projector extends ClassHandle {
}

export interface HLRBRep_Algo extends ClassHandle {
  Projector(_0: HLRAlgo_Projector): void;
  Update(): void;
  Hide(): void;
  Add(_0: TopoDS_Shape, _1: number): void;
}

export interface HLRBRep_HLRToShape extends ClassHandle {
  VCompound(): TopoDS_Shape;
  HCompound(): TopoDS_Shape;
  OutLineVCompound(): TopoDS_Shape;
  OutLineHCompound(): TopoDS_Shape;
  Rg1LineVCompound(): TopoDS_Shape;
  Rg1LineHCompound(): TopoDS_Shape;
}

export interface IFSelect_ReturnStatusValue<T extends number> {
  value: T;
}
export type IFSelect_ReturnStatus = IFSelect_ReturnStatusValue<0>|IFSelect_ReturnStatusValue<1>|IFSelect_ReturnStatusValue<2>|IFSelect_ReturnStatusValue<3>|IFSelect_ReturnStatusValue<4>;

export interface STEPControl_StepModelTypeValue<T extends number> {
  value: T;
}
export type STEPControl_StepModelType = STEPControl_StepModelTypeValue<0>;

export interface STEPControl_Writer extends ClassHandle {
  Transfer(_0: TopoDS_Shape, _1: STEPControl_StepModelType, _2: boolean, _3: Message_ProgressRange): IFSelect_ReturnStatus;
  Write(_0: EmbindString): IFSelect_ReturnStatus;
}

export interface STEPControl_Reader extends ClassHandle {
  OneShape(): TopoDS_Shape;
  TransferRoots(_0: Message_ProgressRange): number;
  NbRootsForTransfer(): number;
  ReadFile(_0: EmbindString): IFSelect_ReturnStatus;
}

export interface TDF_Label extends ClassHandle {
  IsNull(): boolean;
}

export interface TDF_LabelSequence extends ClassHandle {
  Length(): number;
  Value(_0: number): TDF_Label;
}

export interface TDocStd_Document extends ClassHandle {
  Main(): TDF_Label;
}

export interface XCAFApp_Application extends ClassHandle {
  NewDocument(): TDocStd_Document | null;
  Close(_0: TDocStd_Document | null): void;
}

export interface XCAFDoc_DocumentTool extends ClassHandle {
}

export interface XCAFDoc_ShapeTool extends ClassHandle {
  GetFreeShapes(): TDF_LabelSequence;
  NewShape(): TDF_Label;
  AddComponent(_0: TDF_Label, _1: TDF_Label, _2: TopLoc_Location): TDF_Label;
  AddSubShape(_0: TDF_Label, _1: TopoDS_Shape): TDF_Label;
  UpdateAssemblies(): void;
  AddShape(_0: TopoDS_Shape, _1: boolean, _2: boolean): TDF_Label;
}

export interface XCAFDoc_ColorTypeValue<T extends number> {
  value: T;
}
export type XCAFDoc_ColorType = XCAFDoc_ColorTypeValue<0>|XCAFDoc_ColorTypeValue<1>|XCAFDoc_ColorTypeValue<2>;

export interface XCAFDoc_ColorTool extends ClassHandle {
  SetColor(_0: TDF_Label, _1: RGB, _2: XCAFDoc_ColorType): void;
}

export interface TDataStd_Name extends ClassHandle {
}

export interface STEPCAFControl_Reader extends ClassHandle {
  SetNameMode(_0: boolean): void;
  SetColorMode(_0: boolean): void;
  Transfer(_0: TDocStd_Document | null, _1: Message_ProgressRange): boolean;
  ReadFile(_0: EmbindString): IFSelect_ReturnStatus;
}

export interface STEPCAFControl_Writer extends ClassHandle {
  SetNameMode(_0: boolean): void;
  SetColorMode(_0: boolean): void;
  Transfer(_0: TDocStd_Document | null, _1: Message_ProgressRange): boolean;
  Write(_0: EmbindString): IFSelect_ReturnStatus;
}

export type RGB = [ number, number, number ];

interface EmbindModule {
  Message_ProgressRange: {
    new(): Message_ProgressRange;
  };
  gp_Trsf: {
    new(): gp_Trsf;
  };
  gp_Pnt: {
    new(_0: number, _1: number, _2: number): gp_Pnt;
  };
  gp_Dir: {
    new(_0: number, _1: number, _2: number): gp_Dir;
  };
  gp_Vec: {
    new(_0: number, _1: number, _2: number): gp_Vec;
  };
  gp_Ax1: {
    new(_0: gp_Pnt, _1: gp_Dir): gp_Ax1;
  };
  gp_Ax2: {
    new(_0: gp_Pnt, _1: gp_Dir): gp_Ax2;
    new(_0: gp_Pnt, _1: gp_Dir, _2: gp_Dir): gp_Ax2;
  };
  gp_Pln: {};
  gp_Circ: {};
  gp_Cylinder: {};
  TopLoc_Location: {
    new(): TopLoc_Location;
    new(_0: gp_Trsf): TopLoc_Location;
  };
  TopoDS_Shape: {
    new(): TopoDS_Shape;
  };
  TopoDS_Edge: {};
  TopoDS_Face: {};
  TopoDS_Solid: {};
  TopoDS_Compound: {
    new(): TopoDS_Compound;
  };
  TopoDS: {
    Edge(_0: TopoDS_Shape): TopoDS_Edge;
    Face(_0: TopoDS_Shape): TopoDS_Face;
    Solid(_0: TopoDS_Shape): TopoDS_Solid;
  };
  TopoDS_Builder: {
    new(): TopoDS_Builder;
  };
  TopExp_Explorer: {
    new(_0: TopoDS_Shape, _1: TopAbs_ShapeEnum, _2: TopAbs_ShapeEnum): TopExp_Explorer;
  };
  TopAbs_ShapeEnum: {TopAbs_COMPOUND: TopAbs_ShapeEnumValue<0>, TopAbs_COMPSOLID: TopAbs_ShapeEnumValue<1>, TopAbs_SOLID: TopAbs_ShapeEnumValue<2>, TopAbs_SHELL: TopAbs_ShapeEnumValue<3>, TopAbs_FACE: TopAbs_ShapeEnumValue<4>, TopAbs_WIRE: TopAbs_ShapeEnumValue<5>, TopAbs_EDGE: TopAbs_ShapeEnumValue<6>, TopAbs_VERTEX: TopAbs_ShapeEnumValue<7>, TopAbs_SHAPE: TopAbs_ShapeEnumValue<8>};
  TopAbs_Orientation: {TopAbs_FORWARD: TopAbs_OrientationValue<0>, TopAbs_REVERSED: TopAbs_OrientationValue<1>, TopAbs_INTERNAL: TopAbs_OrientationValue<2>, TopAbs_EXTERNAL: TopAbs_OrientationValue<3>};
  GeomAbs_CurveType: {GeomAbs_Line: GeomAbs_CurveTypeValue<0>, GeomAbs_Circle: GeomAbs_CurveTypeValue<1>, GeomAbs_Ellipse: GeomAbs_CurveTypeValue<2>, GeomAbs_Hyperbola: GeomAbs_CurveTypeValue<3>, GeomAbs_Parabola: GeomAbs_CurveTypeValue<4>, GeomAbs_BezierCurve: GeomAbs_CurveTypeValue<5>, GeomAbs_BSplineCurve: GeomAbs_CurveTypeValue<6>, GeomAbs_OffsetCurve: GeomAbs_CurveTypeValue<7>, GeomAbs_OtherCurve: GeomAbs_CurveTypeValue<8>};
  GeomAbs_SurfaceType: {GeomAbs_Plane: GeomAbs_SurfaceTypeValue<0>, GeomAbs_Cylinder: GeomAbs_SurfaceTypeValue<1>, GeomAbs_Cone: GeomAbs_SurfaceTypeValue<2>, GeomAbs_Sphere: GeomAbs_SurfaceTypeValue<3>, GeomAbs_Torus: GeomAbs_SurfaceTypeValue<4>, GeomAbs_BezierSurface: GeomAbs_SurfaceTypeValue<5>, GeomAbs_BSplineSurface: GeomAbs_SurfaceTypeValue<6>, GeomAbs_SurfaceOfRevolution: GeomAbs_SurfaceTypeValue<7>, GeomAbs_SurfaceOfExtrusion: GeomAbs_SurfaceTypeValue<8>, GeomAbs_OffsetSurface: GeomAbs_SurfaceTypeValue<9>, GeomAbs_OtherSurface: GeomAbs_SurfaceTypeValue<10>};
  BRepPrimAPI_MakeBox: {
    new(_0: any, _1: number, _2: number, _3: number): BRepPrimAPI_MakeBox;
  };
  BRepPrimAPI_MakeCylinder: {
    new(_0: gp_Ax2, _1: number, _2: number): BRepPrimAPI_MakeCylinder;
  };
  BRepPrimAPI_MakePrism: {
    new(_0: TopoDS_Shape, _1: gp_Vec, _2: boolean, _3: boolean): BRepPrimAPI_MakePrism;
  };
  BRepAlgoAPI_Cut: {
    new(_0: TopoDS_Shape, _1: TopoDS_Shape, _2: Message_ProgressRange): BRepAlgoAPI_Cut;
  };
  BRepAlgoAPI_Fuse: {
    new(_0: TopoDS_Shape, _1: TopoDS_Shape, _2: Message_ProgressRange): BRepAlgoAPI_Fuse;
  };
  BRepAlgoAPI_Common: {
    new(_0: TopoDS_Shape, _1: TopoDS_Shape, _2: Message_ProgressRange): BRepAlgoAPI_Common;
  };
  BRepBuilderAPI_Transform: {
    new(_0: TopoDS_Shape, _1: gp_Trsf, _2: boolean, _3: boolean): BRepBuilderAPI_Transform;
  };
  BRepCheck_Analyzer: {
    new(_0: TopoDS_Shape, _1: boolean, _2: boolean, _3: boolean): BRepCheck_Analyzer;
  };
  ChFi3d_FilletShape: {ChFi3d_Rational: ChFi3d_FilletShapeValue<0>, ChFi3d_QuasiAngular: ChFi3d_FilletShapeValue<1>, ChFi3d_Polynomial: ChFi3d_FilletShapeValue<2>};
  BRepFilletAPI_MakeFillet: {
    new(_0: TopoDS_Shape, _1: ChFi3d_FilletShape): BRepFilletAPI_MakeFillet;
  };
  BRepFilletAPI_MakeChamfer: {
    new(_0: TopoDS_Shape): BRepFilletAPI_MakeChamfer;
  };
  TopTools_ListOfShape: {
    new(): TopTools_ListOfShape;
  };
  BRepOffsetAPI_MakeThickSolid: {
    new(): BRepOffsetAPI_MakeThickSolid;
  };
  BRepExtrema_DistShapeShape: {
    new(_0: TopoDS_Shape, _1: TopoDS_Shape): BRepExtrema_DistShapeShape;
  };
  Bnd_Box: {
    new(): Bnd_Box;
  };
  BRepBndLib: {
    AddOptimal(_0: TopoDS_Shape, _1: Bnd_Box, _2: boolean, _3: boolean): void;
  };
  GProp_GProps: {
    new(): GProp_GProps;
  };
  BRepGProp: {
    VolumeProperties(_0: TopoDS_Shape, _1: GProp_GProps, _2: boolean, _3: boolean, _4: boolean): void;
    SurfaceProperties(_0: TopoDS_Shape, _1: GProp_GProps, _2: boolean, _3: boolean): void;
  };
  Precision: {
    Confusion(): number;
  };
  BRepAdaptor_Curve: {
    new(_0: TopoDS_Edge): BRepAdaptor_Curve;
  };
  BRepAdaptor_Surface: {
    new(_0: TopoDS_Face, _1: boolean): BRepAdaptor_Surface;
  };
  BRepMesh_IncrementalMesh: {
    new(_0: TopoDS_Shape, _1: number, _2: boolean, _3: number, _4: boolean): BRepMesh_IncrementalMesh;
  };
  Poly_Triangle: {};
  Poly_Triangulation: {};
  BRep_Tool: {
    Degenerated(_0: TopoDS_Edge): boolean;
    Triangulation(_0: TopoDS_Face, _1: TopLoc_Location, _2: number): Poly_Triangulation | null;
  };
  BRepLib: {
    BuildCurves3d(_0: TopoDS_Shape): boolean;
  };
  HLRAlgo_Projector: {
    new(_0: gp_Ax2): HLRAlgo_Projector;
  };
  HLRBRep_Algo: {
    new(): HLRBRep_Algo;
  };
  HLRBRep_HLRToShape: {
    new(_0: HLRBRep_Algo): HLRBRep_HLRToShape;
  };
  IFSelect_ReturnStatus: {IFSelect_RetVoid: IFSelect_ReturnStatusValue<0>, IFSelect_RetDone: IFSelect_ReturnStatusValue<1>, IFSelect_RetError: IFSelect_ReturnStatusValue<2>, IFSelect_RetFail: IFSelect_ReturnStatusValue<3>, IFSelect_RetStop: IFSelect_ReturnStatusValue<4>};
  STEPControl_StepModelType: {STEPControl_AsIs: STEPControl_StepModelTypeValue<0>};
  STEPControl_Writer: {
    new(): STEPControl_Writer;
  };
  STEPControl_Reader: {
    new(): STEPControl_Reader;
  };
  TDF_Label: {};
  TDF_LabelSequence: {};
  TDocStd_Document: {};
  XCAFApp_Application: {
    GetApplication(): XCAFApp_Application | null;
  };
  XCAFDoc_DocumentTool: {
    ShapeTool(_0: TDF_Label): XCAFDoc_ShapeTool | null;
    ColorTool(_0: TDF_Label): XCAFDoc_ColorTool | null;
  };
  XCAFDoc_ShapeTool: {
    GetComponents(_0: TDF_Label): TDF_LabelSequence;
    GetReferredShape(_0: TDF_Label): TDF_Label;
    GetShape(_0: TDF_Label): TopoDS_Shape;
    GetLocation(_0: TDF_Label): TopLoc_Location;
    GetSubShapes(_0: TDF_Label): TDF_LabelSequence;
    IsAssembly(_0: TDF_Label): boolean;
  };
  XCAFDoc_ColorType: {XCAFDoc_ColorGen: XCAFDoc_ColorTypeValue<0>, XCAFDoc_ColorSurf: XCAFDoc_ColorTypeValue<1>, XCAFDoc_ColorCurv: XCAFDoc_ColorTypeValue<2>};
  XCAFDoc_ColorTool: {
    GetColor(_0: TDF_Label, _1: XCAFDoc_ColorType): any;
  };
  TDataStd_Name: {
    Set(_0: TDF_Label, _1: EmbindString): void;
    Get(_0: TDF_Label): string;
  };
  STEPCAFControl_Reader: {
    new(): STEPCAFControl_Reader;
  };
  STEPCAFControl_Writer: {
    new(): STEPCAFControl_Writer;
  };
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
