import react from '@vitejs/plugin-react'
import process from 'node:process'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the site from /<repo>/, which the deploy workflow passes in.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
})
