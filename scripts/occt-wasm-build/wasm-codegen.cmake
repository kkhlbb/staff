# With Emscripten 4.0.23, compiling these translation units at -O2 can
# change instruction order across clean builds. Keep the override local.
function(cunlian_set_stable_codegen)
  set_property(SOURCE
    "${CMAKE_SOURCE_DIR}/src/BRepFill/BRepFill_MultiLine.cxx"
    "${CMAKE_SOURCE_DIR}/src/TopOpeBRepBuild/TopOpeBRepBuild_GridSS.cxx"
    TARGET_DIRECTORY TKBool APPEND PROPERTY COMPILE_OPTIONS -O0)
  set_property(SOURCE "${CMAKE_SOURCE_DIR}/src/TopOpeBRepDS/TopOpeBRepDS_EXPORT.cxx"
    TARGET_DIRECTORY TKBool APPEND PROPERTY COMPILE_OPTIONS -O1)
  set_property(SOURCE "${CMAKE_SOURCE_DIR}/src/Extrema/Extrema_ExtCS.cxx"
    TARGET_DIRECTORY TKGeomBase APPEND PROPERTY COMPILE_OPTIONS -O1)
  set_property(SOURCE "${CMAKE_SOURCE_DIR}/src/BRepOffset/BRepOffset_MakeOffset_1.cxx"
    TARGET_DIRECTORY TKOffset APPEND PROPERTY COMPILE_OPTIONS -O1)
  set_property(SOURCE "${CMAKE_SOURCE_DIR}/src/Font/Font_FontMgr.cxx"
    TARGET_DIRECTORY TKService APPEND PROPERTY COMPILE_OPTIONS -O1)
endfunction()

cmake_language(DEFER CALL cunlian_set_stable_codegen)
