import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Empty interface is structurally equivalent to its extended supertype;
    // shadcn scaffold shape, not worth hand-editing for one lint rule.
    files: ["src/components/ui/textarea.tsx"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    // These files export a non-component constant/helper alongside their
    // component(s), which breaks React Fast Refresh's file-shape assumption.
    // shadcn scaffold shape, not worth splitting into extra files.
    files: [
      "src/components/ui/badge.tsx",
      "src/components/ui/button.tsx",
      "src/components/ui/form.tsx",
    ],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // d3-sankey mutates the graph it is given and hands back layout objects
    // its own types do not describe. Quarantined to this file so that
    // no-explicit-any stays an error everywhere else — including the Phase 1
    // data-model work, which is exactly where an `any` would do real damage.
    files: ["src/components/SankeyDiagram.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Tailwind plugin loading is require()-based by convention.
    files: ["tailwind.config.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
