import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/pi-cues/',
  lang: 'en-US',
  title: "pi-cues",
  description: 'Deterministic context loading for the pi coding agent: a central trigger table maps bash commands and tool-operated file paths to skills and prompt files',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'ADRs', link: '/adrs/' },
      { text: 'GitHub', link: 'https://github.com/YewFence/pi-cues' }
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' }
        ]
      },
      {
        text: 'ADRs',
        items: [
          { text: 'Overview', link: '/adrs/' },
          { text: '0001 Central trigger table', link: '/adrs/0001-central-trigger-table' },
          { text: '0002 shell-quote heuristics', link: '/adrs/0002-shell-quote-heuristics' },
          { text: '0003 Skill injection', link: '/adrs/0003-skill-injection' },
          { text: '0004 Walk-up anchor', link: '/adrs/0004-walkup-anchor-cwd' },
          { text: '0005 Content-addressed dedup', link: '/adrs/0005-content-addressed-dedup' },
          { text: '0006 user_bash nextTurn', link: '/adrs/0006-user-bash-next-turn' },
          { text: '0007 Trust and boundaries', link: '/adrs/0007-trust-and-boundaries' },
          { text: '0008 Builtin defaults', link: '/adrs/0008-builtin-defaults' },
          { text: '0009 Project config under extensions', link: '/adrs/0009-project-config-under-extensions' },
          { text: '0010 Walkup explicit trust gate', link: '/adrs/0010-walkup-explicit-trust-gate' },
          { text: '0011 Walkup exclude', link: '/adrs/0011-walkup-exclude' },
          { text: '0012 Injection envelope', link: '/adrs/0012-injection-envelope' },
          { text: '0013 exec action', link: '/adrs/0013-exec-action' }
        ]
      }
    ],

    search: {
      provider: 'local'
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/YewFence/pi-cues' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © YewFence'
    },

    docFooter: {
      prev: 'Previous page',
      next: 'Next page'
    },

    outline: {
      label: 'On this page'
    },

    lastUpdated: {
      text: 'Last updated'
    }
  }
})
