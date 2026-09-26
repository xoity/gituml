# GitUML

GitUML is a fork of an earlier repository-diagram project, extended with an
evidence-based UML chooser. It is maintained by Mohammad Abu-Khader and
released under the MIT license in [LICENSE](../LICENSE). The upstream MIT notice
covering the code this project derives from is kept in
[THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).

## Run

Use Bun 1.3.14 or later: `bun install --frozen-lockfile`, then `bun run dev`.
Set `OPENCODE_API_KEY` in your local environment, or use the OpenCode Go key
dialog. Never commit keys. The verified model ID is
`deepseek-v4-flash-vision-exp`; `OPENCODE_MODEL` overrides it.

OpenCode Go requests use `https://opencode.ai/zen/go/v1/chat/completions`,
`User-Agent: gituml/0.1`, and a stable `x-opencode-session` per operation.
The OpenAI SDK is reused; no new provider dependency is required. Go is intended
for coding-agent traffic and has subscription usage limits. Confirm your public
deployment's usage is permitted before serving arbitrary public traffic.
See <https://opencode.ai/docs/go/>.

Server-funded UML calls require the existing Upstash environment variables and
fail closed if the daily token ledger is unavailable. `UML_DAILY_TOKEN_LIMIT`
defaults to 10 million tokens. Each operation reserves up to 1 million tokens;
measured usage replaces that bound, and unmeasured attempts retain conservative
estimates. Browser-supplied keys have separate HttpOnly, same-origin cookies and
are never forwarded to the retained OpenAI routes.

R2 is optional for local UML use. Configure the existing R2 variables and
`CACHE_KEY_SECRET` for persistence. Cached results are separated by repository,
diagram type, model and source fingerprint. GitHub access is checked before each
read; private results use the inherited token-derived private namespace. Missing
storage is reported rather than pretending results were saved. Use separate
GitUML buckets and Redis credentials, not the live GitUML deployment's data.
Set `NEXT_PUBLIC_SITE_URL` to your deployment origin.

## Workflow and notation

Enter a repository, analyze it, select an applicable diagram, then generate.
All 18 requested types are listed; unsupported recommendations remain disabled
with an insufficient-evidence label. The API accepts only known type IDs.

Class, sequence, state, ER, and C4 use native Mermaid grammars. Use case,
activity, component, deployment, package, communication, infrastructure, data
flow and data pipeline views use deterministic graph projections with the
original ELK renderer. Object snapshots use class notation with an instance
stereotype. BPMN is a process projection, not BPMN 2.0 interchange. Timing uses a
Mermaid Gantt timeline, not native UML timing notation. These limitations are
shown beside affected choices.

The source budget remains 12 files / 48,000 characters, with a 12-second
enrichment deadline. SQL, Prisma, Terraform, Bicep, Docker and common deployment
manifests are eligible alongside code. No full-repository static call graph is
claimed. Recommendations, nodes, relationships, members and intervals require
exact quotations from inspected excerpts. This detects fabricated citations,
not incorrect interpretations of genuine quotations; review important diagrams
against the source. Repository material is explicitly untrusted in prompts.

The model emits bounded JSON, never raw Mermaid. Local schemas, reference
validation, up to three focused repair attempts, deterministic escaping,
DOMPurify and GitHub-only links remain in place. ELK spacing, centering, pan/zoom,
export and reduced-motion animations are unchanged. Native Mermaid diagram
families have their own layout rules; pixel-identical routing across all types
is not possible. UML requests currently return final validated JSON rather than
the overview pipeline's token-by-token explanation stream.

The overview, admin, browse and optional video subsystems are inherited and
kept. The repository page uses the UML chooser, while `/api/generate/stream`
still serves the general architecture overview. The Browse index is an overview
index, not a UML catalog. Videos need their own provider configuration and stay
off unless both video flags are set.

## Upstream review

Before forking, the derived project's open issues and pull requests were read.
Three reported problems shaped this fork: fabricated connections (mitigated with
per-element source citations), private-repository setup on the home form
(implemented), and low-resolution PNG export (the inherited exporter already
renders the SVG independently at up to 4x and excludes the zoom controls).
Other reported gaps — exhaustive source indexing, alternative storage backends,
and running against local repositories — were not addressed. No upstream issue,
pull request, commit or remote was created or modified.