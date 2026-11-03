import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NOT cacheComponents / partialPrefetching (the scaffold enables them). They keep visited
  // pages alive in hidden form, so "Add a trip" would reopen with the last trip you typed,
  // and a hidden board would keep its old numbers. Every visit here starts from what's
  // saved and what's live. (Same lesson as Assignment 4.)
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
