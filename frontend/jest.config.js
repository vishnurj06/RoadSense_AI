/**
 * jest.config.js — Jest configuration for Next.js + React Testing Library
 *
 * Using jest-environment-jsdom so React components can render in a
 * simulated DOM without a real browser.
 *
 * Path aliases (@/ → src/) match jsconfig.json so imports resolve
 * identically in tests and production code.
 */
const nextJest = require("next/jest");

const createJestConfig = nextJest({
  // Provide the path to the Next.js app so next/jest can load its config
  dir: "./",
});

/** @type {import('jest').Config} */
const customJestConfig = {
  displayName: "roadsense-frontend",
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],

  // Map @/ to src/ — matches jsconfig.json paths
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // Static asset stubs
    "\\.(css|less|scss|sass)$": "<rootDir>/__mocks__/styleMock.js",
    "\\.(jpg|jpeg|png|gif|svg|ico)$": "<rootDir>/__mocks__/fileMock.js",
  },

  testMatch: [
    "<rootDir>/src/__tests__/**/*.test.{js,jsx}",
    "<rootDir>/src/**/*.test.{js,jsx}",
  ],

  collectCoverageFrom: [
    "src/**/*.{js,jsx}",
    "!src/**/*.test.{js,jsx}",
    "!src/app/layout.js",
  ],

  transformIgnorePatterns: ["/node_modules/(?!(recharts|lucide-react)/)"],
};

module.exports = createJestConfig(customJestConfig);
