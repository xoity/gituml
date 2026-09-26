# GitUML

Evidence-based UML and architecture diagrams from any GitHub repository,
analysed and drawn with OpenCode Go's DeepSeek V4 Flash Vision Exp.

Built and maintained by **Mohammad Abu-Khader**.

Open a repository, let GitUML inspect its real source, choose the diagram type
the code actually supports, then generate it. Class, sequence, state, ER and C4
diagrams use native Mermaid grammars; the remaining views compile through a
deterministic graph compiler, so the diagram still renders centred, evenly
spaced, zoomable and pannable in the same viewer.

- **Applicable types only.** All 18 supported diagram types are listed, and the
  ones the inspected source cannot support stay disabled.
- **Evidence for every element.** Nodes, relationships, members and intervals
  must quote the inspected source; fabricated citations are rejected and repaired.
- **Deterministic rendering.** The model returns bounded JSON, never raw Mermaid.
  Local validation, retries, escaping and SVG sanitisation stay in place.
- **Private repositories.** Add a read-only GitHub token on the home form or in
  the header.
- **Export.** Download a high-resolution PNG or copy the Mermaid source.

## Run locally

Requires [Bun](https://bun.sh/) and an OpenCode Go API key. R2 and Upstash are
optional — see [setup and limitations](docs/gituml.md).

```bash
git clone https://github.com/xoity/gituml.git
cd gituml
bun install
cp .env.example .env
```

Put `OPENCODE_API_KEY` in `.env`, or paste the key into the app's key dialog.
Then start the app:

```bash
bun run dev
```

Open [localhost:3000](http://localhost:3000).

Without R2, generation still works but results are not persisted, and the app
says so. Without Upstash, server-funded calls fail closed instead of spending
unbudgeted.

## Development

Next.js, React, TypeScript, Tailwind CSS and Mermaid.

- [Setup, supported notation and limitations](docs/gituml.md)
- [Architecture](docs/architecture.md)
- [Development guide](docs/dev-setup.md)
- [Deployment recovery](docs/deployment-failover.md)

## License

MIT — see [LICENSE](LICENSE). Third-party notices are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

This project was inspired by GitDiagram.
