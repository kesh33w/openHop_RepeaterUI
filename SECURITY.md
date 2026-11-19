# Security

Report suspected vulnerabilities in this fork privately, using GitHub's **Report a vulnerability** button on the Security tab, not in a public issue.

- **Channel keys** are write-only:
  - The UI never displays a saved channel key.
  - It never sends a placeholder back as a key.
  - A blank replacement key keeps the stored one.
- **Authentication:** the UI only calls the authenticated `/api` and `/auth` endpoints of the backend it was built for. Tokens are kept in memory or browser storage, as upstream does. They are never sent to third parties; the map tile providers receive no credentials.
- **Never commit** credentials, keys or live configuration. Remove them from screenshots and logs before attaching them to issues.
