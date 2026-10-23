//===- handler.h - Event collection for the llubi wasm playground --------===//
//
// Part of the llubi web playground, under the Apache License v2.0 with LLVM
// Exceptions. See https://llvm.org/LICENSE.txt for license information.
//
//===----------------------------------------------------------------------===//

#ifndef LLUBI_WEB_HANDLER_H
#define LLUBI_WEB_HANDLER_H

#include "lib/Context.h"
#include "lib/Value.h"
#include "llvm/IR/Instruction.h"
#include "llvm/Support/raw_ostream.h"

#include <cstddef>
#include <string>
#include <vector>

namespace llubi_web {

struct StackFrame {
  std::string Function;
  std::string Instruction;
  int Line = 0;
  int Column = 0;
};

struct TraceEntry {
  int Line = 0;
  int TargetLine = 0;
  std::string TargetName;
  std::string Kind;
  std::string Text;
};

struct RuntimeIssue {
  std::string Kind;
  std::string Message;
  std::string Detail;
  int Line = 0;
  int Column = 0;
  std::vector<StackFrame> Frames;
};

class WebEventHandler final : public llvm::ubi::EventHandler {
public:
  WebEventHandler(llvm::ubi::Context &Ctx, bool Verbose, size_t OutputLimit);

  bool onInstructionExecuted(llvm::Instruction &I,
                             const llvm::ubi::AnyValue &Result) override;
  void onError(llvm::StringRef Msg) override;
  void onImmediateUB(llvm::StringRef Msg) override;
  void onUnrecognizedInstruction(llvm::Instruction &I) override;
  bool onBBJump(llvm::Instruction &I, llvm::BasicBlock &To) override;
  bool onFunctionEntry(llvm::Function &F,
                       llvm::ArrayRef<llvm::ubi::AnyValue> Args,
                       llvm::CallBase *CallSite) override;
  bool onFunctionExit(llvm::Function &F,
                      const llvm::ubi::AnyValue &RetVal) override;
  bool onPrint(llvm::StringRef Msg) override;
  void onProgramExit(const llvm::ubi::ProgramExitInfo &Info) override;

  const std::string &stdoutText() const { return Stdout; }
  const std::vector<TraceEntry> &traceEntries() const { return TraceEntries; }
  bool stdoutTruncated() const { return StdoutTruncated; }
  bool traceTruncated() const { return TraceTruncated; }
  const std::vector<RuntimeIssue> &issues() const { return Issues; }

private:
  void appendStdout(llvm::StringRef Msg);
  void appendTrace(int Line, llvm::StringRef Text, llvm::StringRef Kind,
                   int TargetLine = 0, llvm::StringRef TargetName = {});
  void addIssue(llvm::StringRef Kind, llvm::StringRef Msg);
  StackFrame locate(llvm::Instruction &I) const;
  int functionLine(llvm::Function &F) const;
  int blockLine(llvm::BasicBlock &BB) const;
  bool traceFull() const;

  llvm::ubi::Context &Ctx;
  bool Verbose;
  size_t Limit;
  std::string Stdout;
  size_t TraceSize = 0;
  bool StdoutTruncated = false;
  bool TraceTruncated = false;
  std::vector<TraceEntry> TraceEntries;
  std::vector<size_t> PendingStdout;
  std::vector<RuntimeIssue> Issues;
};

} // namespace llubi_web

#endif // LLUBI_WEB_HANDLER_H
