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
    : Ctx(Ctx), Verbose(Verbose), Limit(OutputLimit), TraceOS(Trace),
      Printer(Ctx, TraceOS) {}

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

void WebEventHandler::addIssue(llvm::StringRef Kind, llvm::StringRef Msg) {
  RuntimeIssue Issue;
  Issue.Kind = Kind.str();
  Issue.Message = Msg.str();
  Issues.push_back(std::move(Issue));
}

bool WebEventHandler::traceFull() const { return Trace.size() >= Limit; }

bool WebEventHandler::onInstructionExecuted(llvm::Instruction &I,
                                            const llvm::ubi::AnyValue &Result) {
  if (!Verbose || traceFull())
    return true;

  if (Result.isNone())
    Printer << I << '\n';
  else
    Printer << I << " => " << Result << '\n';
  TraceOS.flush();
  if (Trace.size() > Limit) {
    Trace.resize(Limit);
    TraceTruncated = true;
  }
  return true;
}

void WebEventHandler::onError(llvm::StringRef Msg) { addIssue("error", Msg); }

void WebEventHandler::onImmediateUB(llvm::StringRef Msg) {
  addIssue("immediate-ub", Msg);
}

void WebEventHandler::onUnrecognizedInstruction(llvm::Instruction &I) {
  RuntimeIssue Issue;
  Issue.Kind = "unsupported";
  Issue.Message = "Unrecognized instruction.";
  Issue.Frames.push_back(locate(I));
  Issue.Detail = Issue.Frames.front().Instruction;
  Issue.Line = Issue.Frames.front().Line;
  Issue.Column = Issue.Frames.front().Column;
  Issues.push_back(std::move(Issue));
}

bool WebEventHandler::onBBJump(llvm::Instruction &I, llvm::BasicBlock &To) {
  if (!Verbose || traceFull())
    return true;
  TraceOS << I << " jump to ";
  To.printAsOperand(TraceOS, /*PrintType=*/false);
  TraceOS << '\n';
  TraceOS.flush();
  if (Trace.size() > Limit) {
    Trace.resize(Limit);
    TraceTruncated = true;
  }
  return true;
}

bool WebEventHandler::onFunctionEntry(llvm::Function &F,
                                      llvm::ArrayRef<llvm::ubi::AnyValue> Args,
                                      llvm::CallBase *CallSite) {
  (void)CallSite;
  if (!Verbose || traceFull())
    return true;

  Printer << "Entering function: " << F.getName() << '\n';
  size_t ArgSize = F.arg_size();
  for (size_t Idx = 0; Idx < Args.size(); ++Idx) {
    if (Idx >= ArgSize)
      Printer << "  vaarg[" << (Idx - ArgSize) << "] = " << Args[Idx] << '\n';
    else
      Printer << "  " << *F.getArg(static_cast<unsigned>(Idx)) << " = "
              << Args[Idx] << '\n';
  }
  TraceOS.flush();
  if (Trace.size() > Limit) {
    Trace.resize(Limit);
    TraceTruncated = true;
  }
  return true;
}

bool WebEventHandler::onFunctionExit(llvm::Function &F,
                                     const llvm::ubi::AnyValue &RetVal) {
  (void)RetVal;
  if (!Verbose || traceFull())
    return true;
  Printer << "Exiting function: " << F.getName() << '\n';
  TraceOS.flush();
  if (Trace.size() > Limit) {
    Trace.resize(Limit);
    TraceTruncated = true;
  }
  return true;
}

bool WebEventHandler::onPrint(llvm::StringRef Msg) {
  appendStdout(Msg);
  return true;
}

} // namespace llubi_web
