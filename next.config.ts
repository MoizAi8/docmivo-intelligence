import type { NextConfig } from "next";

const workerDependencies = [
  "@napi-rs/canvas*", "@xmldom/xmldom", "argparse", "base64-js", "core-util-is",
  "dingbat-to-unicode", "duck", "immediate", "inherits", "isarray", "jszip", "lie", "lop",
  "mammoth", "option", "pako", "pend", "process-nextick-args", "readable-stream", "safe-buffer",
  "setimmediate", "sprintf-js", "string_decoder", "underscore", "util-deprecate", "xmlbuilder", "yauzl"
];
const config: NextConfig = {
  agentRules: false,
  turbopack: { root: process.cwd() },
  poweredByHeader: false,
  serverExternalPackages: ["pg", "pdfjs-dist", "mammoth", "yauzl", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/**": [
      "./src/server/ingestion/parser-worker.mjs", "./node_modules/pdfjs-dist/package.json",
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs", "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      ...workerDependencies.map(dependency => "./node_modules/"+dependency+"/**/*")
    ]
  },
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'" }
    ];
    return [
      { source: "/:path*", headers: security },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/workspace/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] }
    ];
  },
};

export default config;
