module.exports = {
  rootDir: ".",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
  testEnvironment: "node",
};
