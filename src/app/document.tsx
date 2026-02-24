export const Document: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Scenario Forge | Scenario-Driven Collaboration</title>
      <meta
        name="description"
        content="Generate realistic scenarios, run them, auto-fix failures with Codex, and ship review-ready pull requests."
      />
      <meta
        property="og:title"
        content="Scenario Forge | Scenario-Driven Collaboration"
      />
      <meta
        property="og:description"
        content="Generate realistic scenarios, run them, auto-fix failures with Codex, and ship review-ready pull requests."
      />
      <meta property="og:image" content="/scenarioForge.png" />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta
        name="twitter:title"
        content="Scenario Forge | Scenario-Driven Collaboration"
      />
      <meta
        name="twitter:description"
        content="Generate realistic scenarios, run them, auto-fix failures with Codex, and ship review-ready pull requests."
      />
      <meta name="twitter:image" content="/scenarioForge.png" />
      <link
        rel="preconnect"
        href="https://fonts.googleapis.com"
      />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=VT323&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: `
        :root {
          --forge-fire: #f28a43;
          --forge-hot: #f2a04a;
          --forge-panel: #141a2e;
          --forge-line: #2a3454;
          --forge-ink: #e8e4d7;
          --forge-muted: #9a968a;
          --forge-ok: #4ade80;
        }

        *, *::before, *::after {
          box-sizing: border-box;
        }

        html, body {
          margin: 0;
          padding: 0;
          min-height: 100dvh;
        }

        body {
          background: #0c101b;
          color: var(--forge-ink);
          font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          line-height: 1.5;
        }

        a {
          color: var(--forge-fire);
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }

        button {
          cursor: pointer;
          border: 1px solid #7f482b;
          border-radius: 7px;
          background: linear-gradient(180deg, #ad5a33 0%, #874423 100%);
          color: var(--forge-ink);
          font-weight: 600;
          font-size: 0.89rem;
          padding: 0.52rem 0.75rem;
          font-family: inherit;
          transition: filter 0.12s;
        }
        button:hover:not(:disabled) {
          filter: brightness(1.1);
        }
        button:active:not(:disabled) {
          filter: brightness(0.95);
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        input, select, textarea {
          border: 1px solid var(--forge-line);
          border-radius: 7px;
          background: #0c101b;
          color: var(--forge-ink);
          font-size: 0.88rem;
          padding: 0.52rem 0.62rem;
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s;
        }
        input:focus, select:focus, textarea:focus {
          border-color: var(--forge-fire);
        }
        input::placeholder, textarea::placeholder {
          color: var(--forge-muted);
        }

        select {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239a968a' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 0.6rem center;
          padding-right: 1.8rem;
        }

        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: #2a3454;
          border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #3a4a6a;
        }
      `}} />
      <link rel="modulepreload" href="/src/client.tsx" />
    </head>
    <body>
      {children}
      <script>import("/src/client.tsx")</script>
    </body>
  </html>
);
