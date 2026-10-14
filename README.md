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

Create `.pi/pi-cues.toml` in your project (or `~/.pi/agent/pi-cues.toml` globally; the two are appended, global baseline first):

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

# Any path operation walks up to the session cwd collecting context files
[[triggers]]
tools = ["read", "edit", "write"]
action = "walkup"
target = ["AGENTS.md", "CLAUDE.md"]
```

Each target fires at most once per session (reset on compaction). `/cues status` shows the loaded config, diagnostics, and what has fired.

Out of the box, pi-cues ships one builtin trigger: every read/edit/write walks up to the session cwd collecting `AGENTS.md` (deduplicated against pi's natively loaded context files). Add `defaults = false` to any config file to disable it.

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
