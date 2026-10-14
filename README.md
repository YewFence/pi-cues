# pi-cues

[![Release](https://img.shields.io/github/v/release/YewFence/pi-cues?sort=semver)](https://github.com/YewFence/pi-cues/releases)
[![Docs](https://img.shields.io/badge/docs-online-blue)](https://YewFence.github.io/pi-cues/)
[![License](https://img.shields.io/github/license/YewFence/pi-cues)](LICENSE)

Deterministic context loading for the pi coding agent: a central trigger table maps bash commands and tool-operated file paths to skills and prompt files

> [!NOTE]
> This project is in an early development stage. Core features may be missing, and backward compatibility is not guaranteed.

## Quick Start

### Installation

> [!IMPORTANT]
> [PLACEHOLDER] Document how users install or access this project.

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

## License

[MIT License](LICENSE)
