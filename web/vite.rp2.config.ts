import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Built on the deployment host; the Pi serves files with Python, never Node.
export default defineConfig({
  root: fileURLToPath(new URL("./rp2", import.meta.url)),
  plugins: [tailwindcss()],
  publicDir: false,
  build: {
    outDir: "../../rp2/dist",
    emptyOutDir: true,
    assetsDir: "pi-assets",
  },
});
