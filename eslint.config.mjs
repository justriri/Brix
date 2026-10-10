import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // contracts/ is an isolated Hardhat subproject with its own toolchain
    // (own package.json/node_modules, never imported by this Next.js app —
    // see contracts/package.json's own doc comment). Its generated
    // typechain-types/ and artifacts/ are build output, not source this
    // app's linter should ever see.
    "contracts/**",
  ]),
]);

export default eslintConfig;
