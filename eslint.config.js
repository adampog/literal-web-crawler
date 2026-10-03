// ESLint flat config. The engine files in core/ are plain scripts (no modules)
// because QML imports them directly, so each area gets its own globals.
const js = require("@eslint/js");
const globals = require("globals");

const shared = {
  ...js.configs.recommended.rules,
  "no-var": "off", // core/ must use var so QML exposes its top-level names
  eqeqeq: ["error", "always"],
  curly: ["error", "multi-line"],
  "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^(CRAWLER_PALETTE|createCrawler|drawSpider|buildScreenMap|screenFoothold|screenChunkAt)$" }],
  "prefer-const": "off",
  "no-shadow": "error"
};

module.exports = [
  { ignores: ["node_modules/**"] },
  {
    files: ["core/**/*.js"],
    languageOptions: { ecmaVersion: 2020, sourceType: "script", globals: {} },
    rules: shared
  },
  {
    files: ["web/**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
      globals: { ...globals.browser, createCrawler: "readonly", drawSpider: "readonly", CRAWLER_PALETTE: "readonly" }
    },
    rules: shared
  },
  {
    files: ["test/**/*.js", "scripts/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: globals.node },
    rules: { ...shared, "no-var": "error", "prefer-const": "error" }
  }
];
