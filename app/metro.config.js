// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// expo-sqlite's web backend (wa-sqlite) ships a .wasm binary it imports directly —
// without this, Metro's web bundler can't resolve it (see docs/development.md's web
// support notes).
config.resolver.assetExts.push("wasm");

// That same web backend uses SharedArrayBuffer for its worker, which browsers only
// expose on a "cross-origin isolated" page — these two response headers are what that
// requires. Without them, opening the database throws at runtime (bundling still
// succeeds either way, so this is easy to miss until you actually load the page).
// A production deployment needs the same two headers set by whatever serves the build.
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    middleware(req, res, next);
  },
};

module.exports = config;
