import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  base: mode === 'sdk' ? '/' : './',
  plugins: [vue()],
  // Library builds inline Vue and Element Plus. Replace Node's environment check
  // so the IIFE can run in a plain browser without a `process` global.
  define: mode === 'sdk' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : undefined,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: mode === 'sdk'
    ? {
        outDir: 'dist-sdk',
        emptyOutDir: true,
        cssCodeSplit: false,
        lib: {
          entry: fileURLToPath(new URL('./src/sdk.ts', import.meta.url)),
          name: 'CustomerServiceSDK',
          formats: ['es', 'iife'],
          fileName: (format) => `customer-service-sdk.${format}.js`,
          cssFileName: 'customer-service-sdk',
        },
      }
    : {
        outDir: 'dist',
        emptyOutDir: true,
      },
}))
