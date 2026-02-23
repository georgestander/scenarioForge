export const Document: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>ScenarioForge | Scenario-Driven Collaboration</title>
      <meta
        name="description"
        content="Generate realistic scenarios, run them, auto-fix failures with Codex, and ship review-ready pull requests."
      />
      <meta
        property="og:title"
        content="ScenarioForge | Scenario-Driven Collaboration"
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
        content="ScenarioForge | Scenario-Driven Collaboration"
      />
      <meta
        name="twitter:description"
        content="Generate realistic scenarios, run them, auto-fix failures with Codex, and ship review-ready pull requests."
      />
      <meta name="twitter:image" content="/scenarioForge.png" />
      <link rel="modulepreload" href="/src/client.tsx" />
    </head>
    <body>
      {children}
      <script>import("/src/client.tsx")</script>
    </body>
  </html>
);
