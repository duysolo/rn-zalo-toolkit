/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  // Thư mục build của Gradle/bob có thể chứa bản sao của source. Không chặn thì mỗi bài test
  // chạy nhiều lần và con số báo cáo là ảo.
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/build/'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'CommonJS',
          target: 'ES2022',
          esModuleInterop: true,
          // `src/errorTable.json` là nguồn duy nhất của bảng ánh xạ lỗi và được test
          // import trực tiếp - thiếu cờ này thì bài test canh sự lệch giữa 2 nền tảng
          // không chạy được.
          resolveJsonModule: true,
        },
      },
    ],
  },
}
