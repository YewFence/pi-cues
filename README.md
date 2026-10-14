# pi-cues

[![Release](https://img.shields.io/github/v/release/YewFence/pi-cues?sort=semver)](https://github.com/YewFence/pi-cues/releases)
[![Docs](https://img.shields.io/badge/docs-online-blue)](https://YewFence.github.io/pi-cues/)
[![License](https://img.shields.io/github/license/YewFence/pi-cues)](LICENSE)

Deterministic context loading for the pi coding agent: a central trigger table maps bash commands and tool-operated file paths to skills and prompt files

> [!NOTE]
> This project is in an early development stage. Core features may be missing, and backward compatibility is not guaranteed.

## Quick Start

### Installation

Until pi-cues is published to npm, install it as a pi package from git or a local clone:

```bash
# From git (cloned and reconciled to the selected ref)
pi install git:github.com/YewFence/pi-cues

# Or from a local clone — point at the repository root (the package root)
git clone https://github.com/YewFence/pi-cues.git
pi install ./pi-cues
```

To try it for a single invocation without adding it to settings: `pi -e git:github.com/YewFence/pi-cues`.

### Build From Source

```bash
git clone https://github.com/YewFence/pi-cues.git
cd pi-cues
mise trust
mise install
mise run deps:install
mise run build
```

### Configuration

Editor validation and autocomplete for the config file (Taplo, Even Better TOML) via the shipped JSON Schema — `/cues status` prints the exact path of the copy inside your installed package:

```toml
#:schema /path/from/cues-status/config.schema.json

version = 1
```

The schema is generated from the `RawConfig` types in `src/piCues/types.ts`; `tests/schema.test.ts` fails when the two drift apart.

Create `.pi/extensions/pi-cues/config.toml` in your project (or `~/.pi/agent/pi-cues.toml` globally; the two are appended, global baseline first). The project file lives under `.pi/extensions/` on purpose: that directory is one of pi's trust-requiring resources, so pi asks for project trust before a cloned repository can ship any pi-cues config, and an untrusted project's config is withheld:

```toml
version = 1

# Running `jj ...` loads the jj-cli skill once per session
[[triggers]]
tools = ["bash"]
when.command = "jj"
action = "skill"
target = "jj-cli"

# Reading or editing a test file injects a prompt file (relative to the config directory)
[[triggers]]
tools = ["read", "edit"]
when.path = "src/**/*.test.ts"
action = "file"
target = "./triggers/vitest.md"

# Running `jj ...` reminds the agent of a one-line convention — no file needed
[[triggers]]
tools = ["bash"]
when.command = "jj"
action = "inline"
target = "Write commit messages in Chinese."

# Any path operation walks up to the session cwd collecting context files
[[triggers]]
tools = ["read", "edit", "write"]
action = "walkup"
target = ["AGENTS.md", "CLAUDE.md"]

# Walkup can drop collected files by pattern: matched against the collected
# file's path relative to the session cwd (POSIX separators). "README.md"
# matches only the cwd-level file; a globstar pattern matches any depth.
exclude = ["README.md"]
```

Each target fires at most once per session (reset on compaction). `/cues status` shows the loaded config, diagnostics, and what has fired.

Out of the box, pi-cues ships one builtin trigger: every read/edit/write walks up to the session cwd collecting `AGENTS.md` (deduplicated against pi's natively loaded context files). Add `defaults = false` to any config file to disable it.

Walk-up collection — builtin and configured — only runs for projects with an explicit trusted decision in pi's `trust.json` (`/trust` records one). Undecided and declined projects collect nothing: pi's `isProjectTrusted()` reports true for projects without trust-requiring resources regardless of saved decisions (see [pi#10947](https://github.com/earendil-works/pi/issues/10947)), so the store file is the only reliable source. `/cues status` shows the current walk-up trust state.

The package also bundles the `pi-cues-authoring` skill, which teaches the agent how to author context for pi-cues (form choice, location-as-scope, wiring discipline).

Security: project config loads only when the project is trusted (pi's project trust); project `file` targets must stay inside the config directory; walk-up never fires for files outside the session cwd. Injected blocks carry a `pi-cues: trigger: ... source: ...` attribution header, and the system prompt gains [one line per session](https://github.com/YewFence/pi-cues/blob/main/src/piCues/index.ts#L74) telling the model that `pi-cues:` blocks are deterministic context.

## Development

```bash
mise run hooks:install
mise run check
mise run test
```

See the [Contributing Guide](CONTRIBUTING.md) for the complete development workflow.

## Documentation

See the [documentation site](https://YewFence.github.io/pi-cues/) for setup, usage, and configuration guidance.

## Contributing

If you have suggestions or find a bug, please [open an issue](https://github.com/YewFence/pi-cues/issues).

Pull requests are welcome. See the [Contributing Guide](CONTRIBUTING.md).

## Acknowledgments

pi-cues' design is inspired by Firefox's [review-context.toml](https://github.com/mozilla-firefox/firefox/blob/main/review-context.toml), which loads review context through deterministic predicates (see [bugbug's design doc](https://github.com/mozilla/bugbug/blob/master/docs/code-review-skills.md)). The implementation references [pi-rules](https://github.com/code-yeongyu/pi-rules) (MIT, © Yeongyu Kim): the glob matcher, truncation budget, walk-up traversal, session dedup pattern, and the `tool_result` injection contract are adapted from its source. The skill `<skill>` block format and frontmatter stripping come from [pi-mention-skill](https://github.com/zigai/pi-tweaks) (MIT, © zigai). See [NOTICE](NOTICE) for details.

## License

[MIT License](LICENSE)
