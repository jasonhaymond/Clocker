// Pure, framework-free business logic shared between every client (currently the Expo
// mobile app in app/, and the thin web client in web/). Nothing in this package imports
// React, React Native, or a browser/Node API — it's just types + calculations, so any
// client can import it regardless of platform or bundler (Metro, Vite, tsc, ...).
//
// What deliberately does NOT live here: local storage (SQLite vs. IndexedDB/nothing),
// the sync/outbox engine, and any UI — those differ enough between an offline-first
// mobile app and a server-dependent web client that sharing them wouldn't save real
// work. See docs/architecture.md's "Two frontend clients, one API" section.

export * from "./types";
export * from "./time";
export * from "./pay";
export * from "./rounding";
export * from "./timesheetPeriods";
export * from "./exportFormat";
export * from "./expectedHours";
