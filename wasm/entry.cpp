//===- entry.cpp - llubi wasm playground entry point ---------------------===//
//
// Part of the llubi web playground, under the Apache License v2.0 with LLVM
// Exceptions. See https://llvm.org/LICENSE.txt for license information.
//
//===----------------------------------------------------------------------===//
//
// This file exposes a small, stable C API for the browser playground.  The
// interpreter itself lives in llvm/tools/llubi/lib; this file only parses
// options, assembles the module, runs it, and turns the results into JSON.
//
//===----------------------------------------------------------------------===//

#include "handler.h"

#include "lib/Context.h"
#include "lib/Value.h"
#include "llvm/ADT/ArrayRef.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/ADT/StringRef.h"
#include "llvm/Analysis/TargetLibraryInfo.h"
#include "llvm/AsmParser/AsmParserContext.h"
#include "llvm/AsmParser/Parser.h"
#include "llvm/Config/llvm-config.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/DerivedTypes.h"
#include "llvm/IR/Function.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Verifier.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/Error.h"
#include "llvm/Support/ErrorHandling.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/SourceMgr.h"
#include "llvm/Support/raw_ostream.h"

#include <emscripten.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <fcntl.h>
#include <limits>
#include <optional>
#include <string>
#include <unistd.h>
#include <utility>
#include <vector>

namespace {

using namespace llvm;

constexpr size_t OutputLimit = 1024 * 1024;
constexpr size_t StderrLimit = 256 * 1024;

std::string LastFatalError;
bool FatalErrorHandlerInstalled = false;

void installFatalErrorHandler() {
  if (FatalErrorHandlerInstalled)
    return;
  install_fatal_error_handler(
      [](void *, const char *Reason, bool) {
        LastFatalError = Reason ? Reason : "unknown fatal error";
      },
      nullptr);
  FatalErrorHandlerInstalled = true;
}

struct Options {
  std::string EntryFunction = "main";
  std::string FakeArgv0;
  std::vector<std::string> Argv;
  uint64_t MaxMem = 64ull * 1024 * 1024;
  uint32_t MaxSteps = 10'000'000;
  uint32_t MaxStackDepth = 256;
  uint32_t VScale = 4;
  uint32_t Seed = 0;
  bool Deterministic = false;
  bool FuseFMulAdd = true;
  bool DisableVerify = false;
  bool Verbose = true;
  ubi::UndefValueBehavior UndefBehavior =
      ubi::UndefValueBehavior::NonDeterministic;
  ubi::NaNPropagationBehavior NaNBehavior =
      ubi::NaNPropagationBehavior::NonDeterministic;
};

std::string jsonToString(json::Value V) {
  std::string Text;
  raw_string_ostream OS(Text);
  OS << V;
  OS.flush();
  return Text;
}

bool getStringField(const json::Object &Obj, StringRef Name, std::string &Out,
                    std::string &Err) {
  if (!Obj.get(Name))
    return true;
  auto Value = Obj.getString(Name);
  if (!Value) {
    Err = "option '" + Name.str() + "' must be a string";
    return false;
  }
  Out = Value->str();
  return true;
}

bool getBoolField(const json::Object &Obj, StringRef Name, bool &Out,
                  std::string &Err) {
  if (!Obj.get(Name))
    return true;
  auto Value = Obj.getBoolean(Name);
  if (!Value) {
    Err = "option '" + Name.str() + "' must be a boolean";
    return false;
  }
  Out = *Value;
  return true;
}

bool getUIntField(const json::Object &Obj, StringRef Name, uint64_t &Out,
                  uint64_t Max, std::string &Err) {
  if (!Obj.get(Name))
    return true;
  auto Value = Obj.getInteger(Name);
  if (!Value || *Value < 0 || static_cast<uint64_t>(*Value) > Max) {
    Err = "option '" + Name.str() + "' must be an integer in [0, " +
          std::to_string(Max) + "]";
    return false;
  }
  Out = static_cast<uint64_t>(*Value);
  return true;
}

bool parseOptions(StringRef Text, Options &Opt, std::string &Err) {
  if (Text.trim().empty())
    return true;

  auto Parsed = json::parse(Text);
  if (!Parsed) {
    Err = toString(Parsed.takeError());
    return false;
  }
  const json::Object *Obj = Parsed->getAsObject();
  if (!Obj) {
    Err = "options must be a JSON object";
    return false;
  }

  if (!getStringField(*Obj, "entryFunction", Opt.EntryFunction, Err) ||
      !getStringField(*Obj, "fakeArgv0", Opt.FakeArgv0, Err))
    return false;

  if (const json::Array *Argv = Obj->getArray("argv")) {
    for (const json::Value &V : *Argv) {
      auto Arg = V.getAsString();
      if (!Arg) {
        Err = "option 'argv' must be an array of strings";
        return false;
      }
      Opt.Argv.push_back(Arg->str());
    }
  } else if (Obj->get("argv")) {
    Err = "option 'argv' must be an array of strings";
    return false;
  }

  uint64_t MaxMem = Opt.MaxMem;
  uint64_t MaxSteps = Opt.MaxSteps;
  uint64_t MaxStackDepth = Opt.MaxStackDepth;
  uint64_t VScale = Opt.VScale;
  uint64_t Seed = Opt.Seed;
  if (!getUIntField(*Obj, "maxMem", MaxMem, 2ull * 1024 * 1024 * 1024 - 1,
                    Err) ||
      !getUIntField(*Obj, "maxSteps", MaxSteps,
                    std::numeric_limits<uint32_t>::max(), Err) ||
      !getUIntField(*Obj, "maxStackDepth", MaxStackDepth,
                    std::numeric_limits<uint32_t>::max(), Err) ||
      !getUIntField(*Obj, "vscale", VScale,
                    std::numeric_limits<uint32_t>::max(), Err) ||
      !getUIntField(*Obj, "seed", Seed, std::numeric_limits<uint32_t>::max(),
                    Err) ||
      !getBoolField(*Obj, "deterministic", Opt.Deterministic, Err) ||
      !getBoolField(*Obj, "fuseFMulAdd", Opt.FuseFMulAdd, Err) ||
      !getBoolField(*Obj, "disableVerify", Opt.DisableVerify, Err) ||
      !getBoolField(*Obj, "verbose", Opt.Verbose, Err))
    return false;

  Opt.MaxMem = MaxMem;
  Opt.MaxSteps = static_cast<uint32_t>(MaxSteps);
  Opt.MaxStackDepth = static_cast<uint32_t>(MaxStackDepth);
  Opt.VScale = static_cast<uint32_t>(VScale);
  Opt.Seed = static_cast<uint32_t>(Seed);

  if (auto Undef = Obj->getString("undefBehavior")) {
    if (*Undef == "nondet")
      Opt.UndefBehavior = ubi::UndefValueBehavior::NonDeterministic;
    else if (*Undef == "zero")
      Opt.UndefBehavior = ubi::UndefValueBehavior::Zero;
    else {
      Err = "option 'undefBehavior' must be 'nondet' or 'zero'";
      return false;
    }
  } else if (Obj->get("undefBehavior")) {
    Err = "option 'undefBehavior' must be a string";
    return false;
  }

  if (auto NaN = Obj->getString("nanBehavior")) {
    if (*NaN == "nondet")
      Opt.NaNBehavior = ubi::NaNPropagationBehavior::NonDeterministic;
    else if (*NaN == "preferred")
      Opt.NaNBehavior = ubi::NaNPropagationBehavior::PreferredNaN;
    else if (*NaN == "quieting")
      Opt.NaNBehavior = ubi::NaNPropagationBehavior::QuietingNaN;
    else if (*NaN == "unchanged")
      Opt.NaNBehavior = ubi::NaNPropagationBehavior::UnchangedNaN;
    else if (*NaN == "target-specific")
      Opt.NaNBehavior = ubi::NaNPropagationBehavior::TargetSpecificNaN;
    else {
      Err = "option 'nanBehavior' has an unknown value";
      return false;
    }
  } else if (Obj->get("nanBehavior")) {
    Err = "option 'nanBehavior' must be a string";
    return false;
  }

  if (Opt.EntryFunction.empty()) {
    Err = "'entryFunction' cannot be empty";
    return false;
  }
  if (Opt.VScale == 0 || (Opt.VScale & (Opt.VScale - 1)) != 0) {
    Err = "'vscale' must be a positive power of two";
    return false;
  }
  if (Opt.MaxMem == 0) {
    Err = "'maxMem' must be greater than zero";
    return false;
  }
  return true;
}

class StderrCapture {
public:
  bool begin() {
    SavedFd = dup(STDERR_FILENO);
    int Fd = open("/tmp/llubi-web-stderr", O_RDWR | O_CREAT | O_TRUNC, 0666);
    if (Fd < 0)
      return false;
    if (dup2(Fd, STDERR_FILENO) < 0) {
      close(Fd);
      return false;
    }
    close(Fd);
    Active = true;
    return true;
  }

  std::string finish() {
    if (!Active)
      return {};
    errs().flush();
    fflush(nullptr);

    if (lseek(STDERR_FILENO, 0, SEEK_SET) >= 0) {
      char Buffer[4096];
      ssize_t N;
      while ((N = read(STDERR_FILENO, Buffer, sizeof(Buffer))) > 0) {
        size_t ToCopy =
            std::min(static_cast<size_t>(N), StderrLimit - Captured.size());
        Captured.append(Buffer, ToCopy);
        if (Captured.size() >= StderrLimit)
          break;
      }
    }

    if (SavedFd >= 0) {
      dup2(SavedFd, STDERR_FILENO);
      close(SavedFd);
      SavedFd = -1;
    }
    Active = false;
    return std::move(Captured);
  }

  ~StderrCapture() {
    if (Active)
      finish();
    else if (SavedFd >= 0)
      close(SavedFd);
  }

private:
  int SavedFd = -1;
  bool Active = false;
  std::string Captured;
};

std::string readCapturedStderr() {
  std::string Captured;
  int Fd = open("/tmp/llubi-web-stderr", O_RDONLY);
  if (Fd < 0)
    return Captured;
  char Buffer[4096];
  ssize_t N;
  while ((N = read(Fd, Buffer, sizeof(Buffer))) > 0) {
    size_t ToCopy =
        std::min(static_cast<size_t>(N), StderrLimit - Captured.size());
    Captured.append(Buffer, ToCopy);
    if (Captured.size() >= StderrLimit)
      break;
  }
  close(Fd);
  return Captured;
}

std::vector<llubi_web::StackFrame> parseStackFrames(StringRef Text) {
  std::vector<llubi_web::StackFrame> Frames;
  SmallVector<StringRef, 32> Lines;
  Text.split(Lines, '\n');

  for (StringRef Line : Lines) {
    Line = Line.trim();
    if (!Line.starts_with("#"))
      continue;
    size_t At = Line.find(" at ");
    if (At == StringRef::npos)
      continue;
    size_t FirstSpace = Line.find(' ');
    if (FirstSpace == StringRef::npos)
      continue;

    llubi_web::StackFrame Frame;
    Frame.Instruction = Line.slice(FirstSpace + 1, At).trim().str();
    StringRef Location = Line.substr(At + 4).trim();
    size_t Colon = Location.rfind(':');
    if (Colon == StringRef::npos)
      continue;
    int LineNo = 0;
    if (Location.substr(Colon + 1).getAsInteger(10, LineNo) || LineNo <= 0)
      continue;
    StringRef FuncAndFile = Location.substr(0, Colon);
    size_t Space = FuncAndFile.rfind(' ');
    if (Space == StringRef::npos)
      continue;
    Frame.Function = FuncAndFile.substr(0, Space).str();
    Frame.Line = LineNo;
    Frames.push_back(std::move(Frame));
  }
  return Frames;
}

const char *exitKindName(ubi::ProgramExitInfo::ProgramExitKind Kind) {
  switch (Kind) {
  case ubi::ProgramExitInfo::ProgramExitKind::Returned:
    return "returned";
  case ubi::ProgramExitInfo::ProgramExitKind::Failed:
    return "failed";
  case ubi::ProgramExitInfo::ProgramExitKind::Exited:
    return "exited";
  case ubi::ProgramExitInfo::ProgramExitKind::Aborted:
    return "aborted";
  case ubi::ProgramExitInfo::ProgramExitKind::Terminated:
    return "terminated";
  }
  llvm_unreachable("unknown ProgramExitKind");
}

json::Object makeDiagnostic(StringRef Phase, StringRef Severity,
                            StringRef Message, int Line, int Column,
                            StringRef Detail,
                            ArrayRef<llubi_web::StackFrame> Frames) {
  json::Object Diag;
  Diag["phase"] = Phase.str();
  Diag["severity"] = Severity.str();
  Diag["message"] = Message.str();
  if (Line > 0)
    Diag["line"] = Line;
  if (Column > 0)
    Diag["column"] = Column;
  if (!Detail.empty())
    Diag["detail"] = Detail.str();
  if (!Frames.empty()) {
    json::Array FrameArray;
    for (const auto &Frame : Frames) {
      json::Object F;
      F["function"] = Frame.Function;
      F["instruction"] = Frame.Instruction;
      if (Frame.Line > 0)
        F["line"] = Frame.Line;
      if (Frame.Column > 0)
        F["column"] = Frame.Column;
      FrameArray.push_back(std::move(F));
    }
    Diag["frames"] = std::move(FrameArray);
  }
  return Diag;
}

std::string makeFailure(StringRef Phase, StringRef Message, int Line = 0,
                        int Column = 0, StringRef Detail = {}) {
  json::Array Diags;
  Diags.push_back(makeDiagnostic(Phase, "error", Message, Line, Column, Detail,
                                 /*Frames=*/{}));

  json::Object Exit;
  Exit["kind"] = "failed";
  Exit["code"] = 1;

  json::Object Root;
  Root["ok"] = false;
  Root["exit"] = std::move(Exit);
  Root["stdout"] = "";
  Root["stderr"] = "";
  Root["trace"] = "";
  Root["diagnostics"] = std::move(Diags);
  Root["truncated"] = false;
  Root["durationMs"] = 0;
  return jsonToString(json::Value(std::move(Root)));
}

std::string runLlubi(StringRef IR, StringRef OptionsText) {
  LastFatalError.clear();
  installFatalErrorHandler();
  auto Start = std::chrono::steady_clock::now();
  Options Opt;
  std::string OptionError;
  if (!parseOptions(OptionsText, Opt, OptionError))
    return makeFailure("options", OptionError);

  StderrCapture Capture;
  bool Capturing = Capture.begin();

  LLVMContext Context;
  const char *Args[] = {"llubi-web"};
  std::string CommandLineError;
  raw_string_ostream CommandLineOS(CommandLineError);
  if (!cl::parseCommandLineOptions(Context.getLibraryOptions(), Args,
                                   /*Overview=*/"", &CommandLineOS)) {
    CommandLineOS.flush();
    return makeFailure("options", "failed to initialize LLVM options",
                       /*Line=*/0, /*Column=*/0, CommandLineError);
  }

  json::Array Diagnostics;
  auto AddDiagnostic = [&](StringRef Phase, StringRef Severity,
                           StringRef Message, int Line, int Column,
                           StringRef Detail,
                           ArrayRef<llubi_web::StackFrame> Frames = {}) {
    Diagnostics.push_back(
        makeDiagnostic(Phase, Severity, Message, Line, Column, Detail, Frames));
  };

  AsmParserContext ParserContext;
  SMDiagnostic ParseError;
  MemoryBufferRef Buffer(IR, "<input>");
  std::unique_ptr<Module> Owner = parseAssembly(
      Buffer, ParseError, Context, /*Slots=*/nullptr,
      [](StringRef, StringRef) -> std::optional<std::string> {
        return std::nullopt;
      },
      &ParserContext);
  if (!Owner) {
    std::string Detail;
    raw_string_ostream OS(Detail);
    ParseError.print("llubi", OS, /*ShowColors=*/false);
    OS.flush();
    int Line = ParseError.getLineNo() > 0 ? ParseError.getLineNo() : 0;
    int Column =
        ParseError.getColumnNo() >= 0 ? ParseError.getColumnNo() + 1 : 0;
    AddDiagnostic("parse", "error", ParseError.getMessage(), Line, Column,
                  Detail);
    std::string StderrText = Capturing ? Capture.finish() : "";
    json::Object Root;
    Root["ok"] = false;
    json::Object Exit;
    Exit["kind"] = "failed";
    Exit["code"] = 1;
    Root["exit"] = std::move(Exit);
    Root["stdout"] = "";
    Root["stderr"] = StderrText;
    Root["trace"] = "";
    Root["diagnostics"] = std::move(Diagnostics);
    Root["truncated"] = false;
    Root["durationMs"] = static_cast<int64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - Start)
            .count());
    return jsonToString(json::Value(std::move(Root)));
  }
  Module &M = *Owner;

  if (!Opt.DisableVerify) {
    std::string VerifyText;
    raw_string_ostream VerifyOS(VerifyText);
    if (verifyModule(M, &VerifyOS)) {
      VerifyOS.flush();
      AddDiagnostic("verify", "error", "input module is broken", 0, 0,
                    VerifyText);
      std::string StderrText = Capturing ? Capture.finish() : "";
      json::Object Root;
      Root["ok"] = false;
      json::Object Exit;
      Exit["kind"] = "failed";
      Exit["code"] = 1;
      Root["exit"] = std::move(Exit);
      Root["stdout"] = "";
      Root["stderr"] = StderrText;
      Root["trace"] = "";
      Root["diagnostics"] = std::move(Diagnostics);
      Root["truncated"] = false;
      Root["durationMs"] = static_cast<int64_t>(
          std::chrono::duration_cast<std::chrono::milliseconds>(
              std::chrono::steady_clock::now() - Start)
              .count());
      return jsonToString(json::Value(std::move(Root)));
    }
  }

  ubi::Context Ctx(M, &ParserContext);
  Ctx.setMemoryLimit(Opt.MaxMem);
  Ctx.setVScale(Opt.VScale);
  Ctx.setMaxSteps(Opt.MaxSteps);
  Ctx.setMaxStackDepth(Opt.MaxStackDepth);
  Ctx.setFusedMultiplyAdd(Opt.FuseFMulAdd);
  Ctx.setDeterministic(Opt.Deterministic);
  Ctx.setUndefValueBehavior(Opt.UndefBehavior);
  Ctx.setNaNPropagationBehavior(Opt.NaNBehavior);
  Ctx.reseed(Opt.Seed);

  if (!Ctx.initGlobalValues()) {
    std::string StderrText = Capturing ? Capture.finish() : "";
    AddDiagnostic("entry", "error",
                  "failed to initialize global values (e.g., the memory limit "
                  "may be too low)",
                  0, 0, "");
    json::Object Root;
    Root["ok"] = false;
    json::Object Exit;
    Exit["kind"] = "failed";
    Exit["code"] = 1;
    Root["exit"] = std::move(Exit);
    Root["stdout"] = "";
    Root["stderr"] = StderrText;
    Root["trace"] = "";
    Root["diagnostics"] = std::move(Diagnostics);
    Root["truncated"] = false;
    Root["durationMs"] = static_cast<int64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - Start)
            .count());
    return jsonToString(json::Value(std::move(Root)));
  }

  Function *EntryFn = M.getFunction(Opt.EntryFunction);
  if (!EntryFn) {
    if (Capturing)
      Capture.finish();
    return makeFailure("entry", "'" + Opt.EntryFunction +
                                    "' function not found in module");
  }
  if (EntryFn->isDeclaration()) {
    if (Capturing)
      Capture.finish();
    return makeFailure("entry",
                       "'" + Opt.EntryFunction + "' must be a definition");
  }

  TargetLibraryInfo TLI(Ctx.getTLIImpl());
  Type *IntTy = IntegerType::get(Context, TLI.getIntSize());
  Type *PtrTy = PointerType::getUnqual(Context);
  auto *MainFuncTy = FunctionType::get(IntTy, {IntTy, PtrTy}, false);

  std::vector<std::string> InputArgv;
  InputArgv.push_back(Opt.FakeArgv0.empty() ? "llubi" : Opt.FakeArgv0);
  InputArgv.insert(InputArgv.end(), Opt.Argv.begin(), Opt.Argv.end());

  SmallVector<ubi::AnyValue> CallArgs;
  if (EntryFn->getFunctionType() == MainFuncTy) {
    const ubi::AnyValue *Argc =
        Ctx.getConstantValue(ConstantInt::get(IntTy, InputArgv.size()));
    if (!Argc) {
      if (Capturing)
        Capture.finish();
      return makeFailure("entry", "failed to initialize argc");
    }
    CallArgs.push_back(*Argc);

    uint32_t PtrSize = Ctx.getDataLayout().getPointerSize();
    uint64_t PtrsSize = PtrSize * (InputArgv.size() + 1);
    auto ArgvPtrsMem =
        Ctx.allocate(PtrsSize, 8, "argv", /*AS=*/0, ubi::MemInitKind::Zeroed,
                     ubi::MemAllocKind::Global);
    if (!ArgvPtrsMem) {
      if (Capturing)
        Capture.finish();
      return makeFailure("entry", "failed to allocate memory for argv");
    }
    for (size_t Idx = 0; Idx < InputArgv.size(); ++Idx) {
      const std::string &Arg = InputArgv[Idx];
      uint64_t Size = Arg.length() + 1;
      auto ArgvStrMem =
          Ctx.allocate(Size, 8, "argv_str", /*AS=*/0, ubi::MemInitKind::Zeroed,
                       ubi::MemAllocKind::Global);
      if (!ArgvStrMem) {
        if (Capturing)
          Capture.finish();
        return makeFailure("entry", "failed to allocate memory for argv");
      }
      ubi::Pointer ArgPtr = Ctx.deriveFromMemoryObject(ArgvStrMem);
      Ctx.storeRawBytes(*ArgvStrMem, 0, Arg.c_str(), Arg.length());
      Ctx.store(*ArgvPtrsMem, Idx * PtrSize, ArgPtr, PtrTy);
    }
    CallArgs.push_back(Ctx.deriveFromMemoryObject(ArgvPtrsMem));
  } else if (!EntryFn->arg_empty()) {
    AddDiagnostic("entry", "warning",
                  "the signature of function '" + Opt.EntryFunction +
                      "' does not match 'int main(int, char**)'; passing null "
                      "values for all arguments",
                  0, 0, "");
    CallArgs.reserve(EntryFn->arg_size());
    for (Argument &Arg : EntryFn->args())
      CallArgs.push_back(ubi::AnyValue::getNullValue(Ctx, Arg.getType()));
  }

  llubi_web::WebEventHandler Handler(Ctx, Opt.Verbose, OutputLimit);
  ubi::AnyValue RetVal;
  ubi::ProgramExitInfo ExitInfo =
      Ctx.runFunction(*EntryFn, CallArgs, RetVal, Handler);

  std::string CapturedStderr = Capturing ? Capture.finish() : "";
  std::vector<llubi_web::StackFrame> Frames = parseStackFrames(CapturedStderr);

  bool Ok = ExitInfo.Kind != ubi::ProgramExitInfo::ProgramExitKind::Failed;
  for (const auto &Issue : Handler.issues()) {
    std::vector<llubi_web::StackFrame> IssueFrames = Issue.Frames;
    if (IssueFrames.empty())
      IssueFrames = Frames;
    int Line = Issue.Line;
    int Column = Issue.Column;
    if (Line == 0 && !IssueFrames.empty())
      Line = IssueFrames.front().Line;
    json::Object Diagnostic =
        makeDiagnostic("runtime", "error", Issue.Message, Line, Column,
                       Issue.Detail, IssueFrames);
    Diagnostic["kind"] = Issue.Kind;
    Diagnostics.push_back(std::move(Diagnostic));
    Ok = false;
  }

  uint64_t ExitCode = 0;
  switch (ExitInfo.Kind) {
  case ubi::ProgramExitInfo::ProgramExitKind::Returned:
    if (EntryFn->getReturnType()->isIntegerTy()) {
      if (RetVal.isPoison()) {
        AddDiagnostic("runtime", "error",
                      "execution of function '" + Opt.EntryFunction +
                          "' resulted in a poison return value",
                      0, 0, "");
        Ok = false;
        ExitCode = 1;
      } else {
        APInt Result = RetVal.asInteger();
        ExitCode = Result.extractBitsAsZExtValue(
            std::min(Result.getBitWidth(), 8U), 0);
      }
    }
    break;
  case ubi::ProgramExitInfo::ProgramExitKind::Failed:
    ExitCode = 1;
    if (Handler.issues().empty())
      AddDiagnostic("runtime", "error",
                    "execution of function '" + Opt.EntryFunction + "' failed",
                    0, 0, "");
    Ok = false;
    break;
  case ubi::ProgramExitInfo::ProgramExitKind::Exited:
    ExitCode = ExitInfo.ExitCode;
    break;
  case ubi::ProgramExitInfo::ProgramExitKind::Aborted:
  case ubi::ProgramExitInfo::ProgramExitKind::Terminated:
    ExitCode = 134;
    break;
  }

  bool Truncated = Handler.stdoutTruncated() || Handler.traceTruncated() ||
                   CapturedStderr.size() >= StderrLimit;

  json::Object Exit;
  Exit["kind"] = exitKindName(ExitInfo.Kind);
  Exit["code"] = ExitCode;

  json::Object Root;
  Root["ok"] = Ok;
  Root["exit"] = std::move(Exit);
  Root["stdout"] = Handler.stdoutText();
  Root["stderr"] = CapturedStderr;
  json::Array Trace;
  for (const auto &Entry : Handler.traceEntries()) {
    json::Object Item;
    Item["line"] = Entry.Line;
    Item["kind"] = Entry.Kind;
    Item["text"] = Entry.Text;
    if (Entry.TargetLine > 0) {
      Item["targetLine"] = Entry.TargetLine;
      Item["targetName"] = Entry.TargetName;
    }
    Trace.push_back(std::move(Item));
  }
  Root["trace"] = std::move(Trace);
  Root["diagnostics"] = std::move(Diagnostics);
  Root["truncated"] = Truncated;
  Root["durationMs"] = static_cast<int64_t>(
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - Start)
          .count());
  return jsonToString(json::Value(std::move(Root)));
}

} // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE const char *llubi_run(const char *IR,
                                           const char *OptionsJSON) {
  static std::string Result;
  Result = runLlubi(IR ? StringRef(IR) : StringRef(),
                    OptionsJSON ? StringRef(OptionsJSON) : StringRef("{}"));
  return Result.c_str();
}

EMSCRIPTEN_KEEPALIVE const char *llubi_last_error() {
  static std::string Output;
  Output = LastFatalError;
  if (Output.empty())
    Output = readCapturedStderr();
  return Output.c_str();
}

EMSCRIPTEN_KEEPALIVE const char *llubi_info() {
  static const std::string Info = [] {
    json::Object Root;
    Root["llvmVersion"] = LLVM_VERSION_STRING;
    Root["protocolVersion"] = 1;
    return jsonToString(json::Value(std::move(Root)));
  }();
  return Info.c_str();
}

} // extern "C"
