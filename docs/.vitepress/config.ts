import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/pi-cues/',
  lang: 'en-US',
  title: "pi-cues",
  description: 'Deterministic context loading for the pi coding agent: a central trigger table maps bash commands and tool-operated file paths to skills and prompt files',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'GitHub', link: 'https://github.com/YewFence/pi-cues' }
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' }
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
