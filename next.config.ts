import { spawnSync } from "node:child_process";
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout.trim() ||
  crypto.randomUUID();

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
  // Serwist's default reloads the page when the browser comes back online.
  // Orbit is local-first and fully usable offline, and the vault key lives
  // only in memory — a reload on every network blip would LOCK the vault.
  // Reconnection is already handled by the sync lifecycle ('online' listener
  // → reconcile pull); the /~offline fallback only shows for failed
  // navigations and recovers on the next manual navigation.
  reloadOnOnline: false,
  // Disable in development — SW is not useful in dev and requires webpack
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  turbopack: {},
};

export default withSerwist(nextConfig);
