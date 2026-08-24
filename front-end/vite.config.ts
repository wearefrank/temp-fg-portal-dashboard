/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Vite's default 5173 falls inside a range Windows reserves for Hyper-V/WSL
    // (check with: netsh interface ipv4 show excludedportrange protocol=tcp),
    // which makes the dev server fail to bind with EACCES. 5500 sits outside
    // every reserved range. strictPort surfaces a conflict instead of silently
    // moving to another port, which would break the OIDC redirect_uri.
    port: 5500,
    strictPort: true,
    proxy: {
      // Account linking, listed before /api so this entry wins. changeOrigin stays off for
      // the same reason as /oauth2 below: Spring builds the link redirect_uri from the Host
      // header, and rewriting it would send the browser to the backend port after linking.
      '/api/git': {
        target: 'http://localhost:8080',
        changeOrigin: false,
        secure: false,
      },
      // Catch any request starting with /api
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
      // OIDC login endpoints. Unlike /api these deliberately keep changeOrigin off:
      // Spring builds the redirect_uri from the incoming Host header, so rewriting it
      // to localhost:8080 would send the browser back to the backend port after login
      // instead of to the dev server. Leaving the Host as localhost:5500 keeps the
      // whole round trip on the dev server.
      '/oauth2': {
        target: 'http://localhost:8080',
        changeOrigin: false,
        secure: false,
      },
      // Only the parts of /login that belong to Spring: the OIDC callback and the password
      // form's POST target. Plain /login stays with Vite, which serves the console's own
      // login page - proxying all of /login would hand that route to the backend, where in
      // dev there is no built SPA to return.
      '/login/oauth2': {
        target: 'http://localhost:8080',
        changeOrigin: false,
        secure: false,
      },
      '/login/password': {
        target: 'http://localhost:8080',
        changeOrigin: false,
        secure: false,
      },
      '/logout': {
        target: 'http://localhost:8080',
        changeOrigin: false,
        secure: false,
      }
    }
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
})
