#!/usr/bin/env node
/**
 * Wrapper mỏng cho `packages/rn-zalo-toolkit/bin/doctor.mjs`.
 *
 * NGUỒN DUY NHẤT nằm trong package, không phải ở đây - vì đó mới là bản đi theo tarball npm
 * và chạy được bằng `npx rn-zalo-toolkit-doctor`. Giữ hai bản song song là mời gọi drift:
 * bản trong repo được sửa, bản người dùng nhận thì không.
 */
import '../packages/rn-zalo-toolkit/bin/doctor.mjs'
