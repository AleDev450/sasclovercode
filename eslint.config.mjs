import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    name: "clovercode/rules",
    rules: {
      // CLOVERCODE_MASTER.md section 14: `any` is forbidden except when
      // explicitly justified. An escape hatch requires an eslint-disable
      // comment with a written reason, which makes it reviewable.
      "@typescript-eslint/no-explicit-any": "error",

      // CLOVERCODE_MASTER.md section 51: never silence a type error.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
          minimumDescriptionLength: 10,
        },
      ],

      // CLOVERCODE_MASTER.md section 16: no stray console.log in production
      // code. Use the structured logger instead.
      "no-console": ["error", { allow: ["warn", "error"] }],

      // Unused code is dead weight; `_`-prefixed args stay allowed for
      // deliberate signature placeholders.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Type-only imports must be explicit so the bundler can erase them.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },

  {
    // Tests may assert on loose shapes and stub globals.
    name: "clovercode/tests",
    files: ["src/tests/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },

  // Must stay last: turns off every rule that would fight Prettier.
  prettier,

  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
