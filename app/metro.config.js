// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// This app lives in an npm workspaces monorepo and depends on the sibling `shared`
// workspace (@clocker/shared) — Metro's default config only watches/resolves within
// `app/` itself, so without these two lines it can't see a workspace package hoisted to
// the monorepo root's node_modules (or the shared package's own source, for fast-refresh
// on changes there). See docs/architecture.md's "Two frontend clients, one API" section.
config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = config;
