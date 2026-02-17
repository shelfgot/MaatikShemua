/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        hebrew: ["'SBL Hebrew'", "'Ezra SIL'", "'Frank Ruehl'", "'Noto Sans Hebrew'", "serif"],
      },
      colors: {
        confidence: {
          high: { bg: '#d4edda', text: '#155724' },
          medium: { bg: '#fff3cd', text: '#856404' },
          low: { bg: '#f8d7da', text: '#721c24' },
        },
      },
    },
  },
  plugins: [],
}
