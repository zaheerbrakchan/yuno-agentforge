/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        orchestrator: "#8b5cf6",
        analyst: "#14b8a6",
        responder: "#f87171",
      },
    },
  },
  plugins: [],
}
