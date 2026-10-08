import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", fetch: "readonly", Buffer: "readonly" } },
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
);
