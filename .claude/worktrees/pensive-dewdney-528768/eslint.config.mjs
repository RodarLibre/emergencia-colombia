import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Type-aware rules need the type checker, so they're scoped to TS files
  // parsed against the real tsconfig — plain .mjs scripts stay untyped.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@eslint-community/eslint-comments": eslintComments,
    },
    rules: {
      // An unawaited DB write in the ingest path loses data silently.
      "@typescript-eslint/no-floating-promises": "error",
      // The `as unknown as Row[]` casts around raw SQL are deliberate and
      // narrow; this keeps them from spreading.
      "@typescript-eslint/no-explicit-any": "error",
      "@eslint-community/eslint-comments/no-unused-disable": "error",
    },
  },
  {
    // console.error is how the integrity guard and rate limiter report;
    // console.log in request paths risks logging user questions.
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // These are operator-invoked CLI tools, not request-serving code — their
    // stdout output is the entire UX, so the request-path rationale above
    // doesn't apply.
    files: ["scripts/**/*.mjs", "src/ingest/run.ts", "src/ingest/seed.ts"],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
