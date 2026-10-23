# Build the browser entry point as an external LLVM project:
#
#   -DLLVM_EXTERNAL_PROJECTS=llubi_web
#   -DLLVM_EXTERNAL_LLUBI_WEB_SOURCE_DIR=/path/to/llubi/wasm
#
# The target links directly against LLVMUBAwareInterpreter from
# llvm/tools/llubi/lib, so no llubi sources are copied into this repository.

add_executable(llubi_web
  entry.cpp
  handler.cpp
  )

set_target_properties(llubi_web PROPERTIES
  OUTPUT_NAME llubi
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/dist/wasm"
  )

target_include_directories(llubi_web PRIVATE
  "${LLVM_MAIN_SRC_DIR}/tools/llubi"
  "${CMAKE_CURRENT_SOURCE_DIR}"
  )

target_compile_options(llubi_web PRIVATE
  -fno-exceptions
  -fno-rtti
  )

set(LLVM_LINK_COMPONENTS
  Analysis
  AsmParser
  Core
  IRPrinter
  IRReader
  Support
  TargetParser
  )

llvm_config(llubi_web ${LLVM_LINK_COMPONENTS})
target_link_libraries(llubi_web PRIVATE LLVMUBAwareInterpreter)
add_dependencies(llubi_web intrinsics_gen)

target_link_options(llubi_web PRIVATE
  --no-entry
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createLlubi
  -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=67108864
  -sMAXIMUM_MEMORY=2147483648
  -sSTACK_SIZE=8388608
  -sFILESYSTEM=1
  -sEXIT_RUNTIME=0
  -sABORTING_MALLOC=0
  -sEXPORTED_FUNCTIONS=_malloc,_free,_llubi_run,_llubi_info
  -sEXPORTED_RUNTIME_METHODS=cwrap,ccall
  )

if(CMAKE_BUILD_TYPE STREQUAL "Debug")
  target_link_options(llubi_web PRIVATE -sASSERTIONS=1)
else()
  target_link_options(llubi_web PRIVATE -sASSERTIONS=0)
endif()
