//===- handler.cpp - Event collection for the llubi wasm playground ------===//
//
// Part of the llubi web playground, under the Apache License v2.0 with LLVM
// Exceptions. See https://llvm.org/LICENSE.txt for license information.
//
//===----------------------------------------------------------------------===//

#include "handler.h"

#include "llvm/AsmParser/AsmParserContext.h"
#include "llvm/IR/BasicBlock.h"
#include "llvm/IR/Function.h"

namespace llubi_web {

WebEventHandler::WebEventHandler(llvm::ubi::Context &Ctx, bool Verbose,
                                 size_t OutputLimit)
    : Ctx(Ctx), Verbose(Verbose), Limit(OutputLimit) {}

StackFrame WebEventHandler::locate(llvm::Instruction &I) const {
  StackFrame Frame;
  Frame.Function = I.getFunction() ? I.getFunction()->getName().str() : "";
  Frame.Instruction = [&] {
    std::string Text;
    llvm::raw_string_ostream OS(Text);
    I.print(OS);
    OS.flush();
    return Text;
  }();

  if (const auto *ParserContext = Ctx.getParserContext())
    if (auto Loc = ParserContext->getInstructionOrArgumentLocation(&I)) {
      Frame.Line = static_cast<int>(Loc->Start.Line) + 1;
      Frame.Column = static_cast<int>(Loc->Start.Col) + 1;
    }
  return Frame;
}

void WebEventHandler::appendStdout(llvm::StringRef Msg) {
  if (StdoutTruncated)
    return;
  if (Stdout.size() + Msg.size() > Limit) {
    size_t Remaining = Limit > Stdout.size() ? Limit - Stdout.size() : 0;
    Stdout.append(Msg.data(), Remaining);
    StdoutTruncated = true;
    return;
  }
  Stdout.append(Msg.data(), Msg.size());
}

int WebEventHandler::functionLine(llvm::Function &F) const {
  if (const auto *ParserContext = Ctx.getParserContext())
    if (auto Loc = ParserContext->getFunctionLocation(&F))
      return static_cast<int>(Loc->Start.Line) + 1;
  return 0;
}

int WebEventHandler::blockLine(llvm::BasicBlock &BB) const {
  if (const auto *ParserContext = Ctx.getParserContext())
    if (auto Loc = ParserContext->getBlockLocation(&BB))
      return static_cast<int>(Loc->Start.Line) + 1;
  return 0;
}

void WebEventHandler::appendTrace(int Line, llvm::StringRef Text,
                                  llvm::StringRef Kind, int TargetLine,
                                  llvm::StringRef TargetName) {
  size_t Start = 0;
  bool FirstLine = true;
  while (Start < Text.size() && !traceFull()) {
    size_t End = Text.find('\n', Start);
    if (End == llvm::StringRef::npos)
      End = Text.size();
    llvm::StringRef LineText = Text.slice(Start, End);
    size_t Available = Limit - TraceSize;
    std::string Stored = LineText.substr(0, Available).str();
    TraceSize += Stored.size();
    TraceEntry Entry;
    Entry.Line = Line;
    Entry.Kind = Kind.str();
    if (FirstLine) {
      Entry.TargetLine = TargetLine;
      Entry.TargetName = TargetName.str();
    }
    Entry.Text = std::move(Stored);
    TraceEntries.push_back(std::move(Entry));
    if (Kind == "stdout")
      PendingStdout.push_back(TraceEntries.size() - 1);
    FirstLine = false;
    if (LineText.size() > Available || TraceSize >= Limit) {
      TraceTruncated = true;
      return;
    }
    ++TraceSize;
    Start = End + 1;
  }

  if (Kind != "stdout" && Line > 0) {
    for (size_t Index : PendingStdout)
      TraceEntries[Index].Line = Line;
    PendingStdout.clear();
  }
}

void WebEventHandler::addIssue(llvm::StringRef Kind, llvm::StringRef Msg) {
  RuntimeIssue Issue;
  Issue.Kind = Kind.str();
  Issue.Message = Msg.str();
  Issues.push_back(std::move(Issue));
}

bool WebEventHandler::traceFull() const { return TraceSize >= Limit; }

bool WebEventHandler::onInstructionExecuted(llvm::Instruction &I,
                                            const llvm::ubi::AnyValue &Result) {
  if (!Verbose || traceFull())
    return true;

  std::string Text;
  llvm::raw_string_ostream OS(Text);
  llvm::ubi::AnyValuePrinter Printer(Ctx, OS);
  if (Result.isNone())
    Printer << I << '\n';
  else
    Printer << I << " => " << Result << '\n';
  OS.flush();
  appendTrace(locate(I).Line, Text, "instruction");
  return true;
}

void WebEventHandler::onError(llvm::StringRef Msg) { addIssue("error", Msg); }

void WebEventHandler::onImmediateUB(llvm::StringRef Msg) {
  addIssue("immediate-ub", Msg);
}

void WebEventHandler::onUnrecognizedInstruction(llvm::Instruction &I) {
  RuntimeIssue Issue;
  StackFrame Frame = locate(I);
  Issue.Kind = "unsupported";
  Issue.Message = "Unrecognized instruction: " + Frame.Instruction;
  Issue.Line = Frame.Line;
  Issue.Column = Frame.Column;
  Issue.Frames.push_back(std::move(Frame));
  Issues.push_back(std::move(Issue));
}

bool WebEventHandler::onBBJump(llvm::Instruction &I, llvm::BasicBlock &To) {
  if (!Verbose || traceFull())
    return true;
  std::string Text;
  llvm::raw_string_ostream OS(Text);
  OS << I << " jump to ";
  To.printAsOperand(OS, /*PrintType=*/false);
  OS << '\n';
  OS.flush();
  appendTrace(locate(I).Line, Text, "branch", blockLine(To), To.getName());
  return true;
}

bool WebEventHandler::onFunctionEntry(llvm::Function &F,
                                      llvm::ArrayRef<llvm::ubi::AnyValue> Args,
                                      llvm::CallBase *CallSite) {
  if (!Verbose || traceFull())
    return true;

  int DefinitionLine = functionLine(F);
  int Line = CallSite ? locate(*CallSite).Line : DefinitionLine;
  int TargetLine = DefinitionLine != Line ? DefinitionLine : 0;
  std::string Text;
  llvm::raw_string_ostream OS(Text);
  llvm::ubi::AnyValuePrinter Printer(Ctx, OS);
  Printer << "Entering function: " << F.getName() << '\n';
  size_t ArgSize = F.arg_size();
  for (size_t Idx = 0; Idx < Args.size(); ++Idx) {
    if (Idx >= ArgSize)
      Printer << "  vaarg[" << (Idx - ArgSize) << "] = " << Args[Idx] << '\n';
    else
      Printer << "  " << *F.getArg(static_cast<unsigned>(Idx)) << " = "
              << Args[Idx] << '\n';
  }
  OS.flush();
  appendTrace(Line, Text, "function", TargetLine,
              TargetLine ? F.getName() : "");
  return true;
}

bool WebEventHandler::onFunctionExit(llvm::Function &F,
                                     const llvm::ubi::AnyValue &RetVal) {
  (void)RetVal;
  if (!Verbose || traceFull())
    return true;
  std::string Text;
  llvm::raw_string_ostream OS(Text);
  OS << "Exiting function: " << F.getName() << '\n';
  OS.flush();
  appendTrace(functionLine(F), Text, "function");
  return true;
}

bool WebEventHandler::onPrint(llvm::StringRef Msg) {
  if (Verbose)
    appendTrace(0, Msg, "stdout");
  appendStdout(Msg);
  return true;
}

void WebEventHandler::onProgramExit(const llvm::ubi::ProgramExitInfo &Info) {
  if (!Verbose)
    return;
  std::string Text;
  llvm::raw_string_ostream OS(Text);
  switch (Info.Kind) {
  case llvm::ubi::ProgramExitInfo::ProgramExitKind::Returned:
  case llvm::ubi::ProgramExitInfo::ProgramExitKind::Failed:
    return;
  case llvm::ubi::ProgramExitInfo::ProgramExitKind::Exited:
    OS << "Program exited with code " << Info.ExitCode << '\n';
    break;
  case llvm::ubi::ProgramExitInfo::ProgramExitKind::Aborted:
    OS << "Program aborted.\n";
    break;
  case llvm::ubi::ProgramExitInfo::ProgramExitKind::Terminated:
    OS << "Program terminated.\n";
    break;
  }
  OS.flush();
  appendTrace(0, Text, "program");
}

} // namespace llubi_web
