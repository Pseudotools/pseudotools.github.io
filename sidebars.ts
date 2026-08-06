import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  // Main sidebar (for overview/intro page)
  // Note: intro page has sidebar: false, so it won't show a sidebar
  tutorialSidebar: [],
  
  // Pseudorandom sidebar
  pseudorandomSidebar: [
    'pseudorandom/index',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'pseudorandom/getting-started/installation',
        'pseudorandom/getting-started/first-steps',
      ],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      items: [
        'pseudorandom/core-concepts/overview',
        'pseudorandom/core-concepts/key-features',
        'pseudorandom/core-concepts/endpoints',
        'pseudorandom/core-concepts/workflows',
        'pseudorandom/core-concepts/guidance',
      ],
    },
    {
      type: 'category',
      label: 'Topics',
      items: [
        'pseudorandom/topics/topic-1',
        'pseudorandom/topics/topic-2',
      ],
    },
    {
      type: 'link',
      label: 'Tools Overview',
      href: '/docs/intro',
    },
  ],
  
  // Pseudocomfy sidebar
  pseudocomfySidebar: [
    'pseudocomfy/index',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'pseudocomfy/getting-started/installation',
        'pseudocomfy/getting-started/first-steps',
      ],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      items: [
        'pseudocomfy/core-concepts/overview',
        'pseudocomfy/core-concepts/key-features',
      ],
    },
    {
      type: 'category',
      label: 'Topics',
      items: [
        'pseudocomfy/topics/library-specification',
        'pseudocomfy/topics/workflow-specification',
        'pseudocomfy/topics/workflow-wizard',
        'pseudocomfy/topics/workflow-review',
      ],
    },
    {
      type: 'link',
      label: 'Tools Overview',
      href: '/docs/intro',
    },
  ],
};

export default sidebars;
