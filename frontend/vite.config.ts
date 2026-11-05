import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [tailwindcss()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "../assets",
    emptyOutDir: false,
    lib: { entry: "src/main.tsx", formats: ["iife"], name: "StudyDashUI", fileName: () => "ui.js" },
    cssCodeSplit: false,
    rollupOptions: { output: { assetFileNames: "ui.[ext]" } },
  },
});
