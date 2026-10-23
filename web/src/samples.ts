export const HELLO_IR = `; A tiny llubi program.
@.str = private unnamed_addr constant [18 x i8] c"Hello from llubi\\0A\\00"

declare i32 @printf(ptr, ...)

define i32 @main() {
  %r = call i32 (ptr, ...) @printf(ptr @.str)
  ret i32 0
}
`;

export const UB_IR = `; llubi reports the exact instruction that triggers immediate UB.
declare ptr @malloc(i64)
declare void @free(ptr)

define i32 @main() {
  %p = call ptr @malloc(i64 4)
  %p_oob = getelementptr i8, ptr %p, i64 8
  call void @free(ptr %p_oob)

  ret i32 0
}
`;
