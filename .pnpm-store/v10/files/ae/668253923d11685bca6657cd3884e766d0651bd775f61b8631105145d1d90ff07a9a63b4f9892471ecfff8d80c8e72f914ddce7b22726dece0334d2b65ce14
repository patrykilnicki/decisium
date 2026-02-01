# @hugeicons/core-free-icons

> Hugeicons core icon package - Raw SVG icon data for use with framework wrappers

## What is Hugeicons?

Hugeicons is a large icon set for modern web and mobile apps. The free package includes 4,600+ Stroke Rounded icons across 59 categories. The Pro package provides 46,000+ icons across 10 styles with multicolor support for Bulk, Duotone, and Twotone styles.

## How It Works

This package (`@hugeicons/core-free-icons`) provides **raw icon data** - it contains the SVG paths and elements for each icon. To render icons in your app, you need to install the corresponding **framework wrapper**:

| Framework | Wrapper Package |
|-----------|----------------|
| React | `@hugeicons/react` |
| React Native | `@hugeicons/react-native` |
| Vue | `@hugeicons/vue` |
| Angular | `@hugeicons/angular` |
| Svelte | `@hugeicons/svelte` |

### Key Highlights

- **4,600+ Free Icons**: Stroke Rounded set across 59 categories for unlimited personal and commercial projects
- **46,000+ Pro Icons, 10 Styles**: Stroke, Solid, Bulk, Duotone, and Twotone families for sharp, rounded, and standard needs
- **Pixel Perfect Grid**: Built on a 24x24 grid for crisp rendering at any size
- **Tree Shaking Ready**: Named exports keep bundles lean in modern bundlers
- **TypeScript Support**: Full type definitions included
- **Regular Updates**: New icons added regularly to keep up with evolving design trends

> **Looking for Pro Icons?** Check out our docs at [hugeicons.com/docs](https://hugeicons.com/docs) for detailed information about pro icons, styles, and advanced usage.

![Hugeicons Icons](https://raw.githubusercontent.com/hugeicons/react/main/assets/icons.png)

## Installation

You must install both this core package AND the wrapper for your framework:

```bash
# React
npm install @hugeicons/react @hugeicons/core-free-icons

# React Native
npm install @hugeicons/react-native @hugeicons/core-free-icons

# Vue
npm install @hugeicons/vue @hugeicons/core-free-icons

# Angular
npm install @hugeicons/angular @hugeicons/core-free-icons

# Svelte
npm install @hugeicons/svelte @hugeicons/core-free-icons
```

## Usage

### React Example

```jsx
import { HugeiconsIcon } from '@hugeicons/react';
import { SearchIcon } from '@hugeicons/core-free-icons';

function App() {
  return (
    <HugeiconsIcon
      icon={SearchIcon}
      size={24}
      color="currentColor"
    />
  );
}
```

### Vue Example

```vue
<template>
  <HugeiconsIcon :icon="SearchIcon" :size="24" />
</template>

<script setup>
import { HugeiconsIcon } from '@hugeicons/vue';
import { SearchIcon } from '@hugeicons/core-free-icons';
</script>
```

### Import Methods

This package now supports multiple import methods for maximum flexibility:

#### 1. Static Import (Tree-shakeable)

Best for production builds when you know which icons you need:

```javascript
import { Home01Icon, User01Icon } from '@hugeicons/core-free-icons';
```

#### 2. Dynamic Import - Full Bundle

Loads the entire icon library (use when you need many icons dynamically):

```javascript
const { Home01Icon } = await import('@hugeicons/core-free-icons');
```

#### 3. Dynamic Import - Individual Icons

Loads only the specific icon you need (99% smaller bundle size):

```javascript
// Loads just ~0.75KB instead of ~5MB!
const icon = await import('@hugeicons/core-free-icons/Home01Icon');
const Home01Icon = icon.default;
```

### Performance Comparison

| Import Method | Bundle Size | Load Time | Best For |
|--------------|-------------|-----------|----------|
| Static Import | ~2-3KB per icon | 0ms (bundled) | Production builds |
| Dynamic Full Bundle | ~5MB | 100-200ms | Many dynamic icons |
| Dynamic Individual | ~0.75KB | 10-20ms | Icon pickers, lazy loading |

For real-world applications, we recommend using our framework-specific packages that provide optimized components and additional features. Check out the Framework Support section below for more details.

## Tree-Shaking Support

This package is optimized for tree-shaking with modern bundlers (Webpack, Rollup, Vite, etc.). When you import icons using the standard syntax, bundlers will automatically eliminate unused icons:

```javascript
// Only the icons you import will be included in your bundle
import { UserIcon, HomeIcon } from '@hugeicons/core-free-icons';

// Bundlers automatically tree-shake unused icons
// Result: Only UserIcon and HomeIcon (~1.5KB) instead of entire library (~5MB)
```

- **Requirements for tree-shaking:**
  - Use a modern bundler (Webpack 5+, Rollup, Vite, Parcel)
  - Ensure your bundler has tree-shaking enabled
  - The package automatically sets `sideEffects: false` for optimal tree-shaking

## Features

- **Individual Icon Imports**: Load only what you need with 99% bundle size reduction
- **Tree-shakeable**: Optimized for modern bundlers
- **Multiple Import Methods**: Static, dynamic bundle, or dynamic individual
- **TypeScript Support**: Full type definitions included
- **Framework Agnostic**: Works with any JavaScript framework
- **Optimized Performance**: Lazy load icons on demand
- **Customizable**: Easy to style with CSS or inline styles
- **ESM & CommonJS**: Support for both module systems
- **Zero Dependencies**: No external dependencies
- **Regular Updates**: New icons added frequently

## Framework Support

Hugeicons provides dedicated packages for various frameworks:

- [@hugeicons/react](https://www.npmjs.com/package/@hugeicons/react) - For React applications
- [@hugeicons/react-native](https://www.npmjs.com/package/@hugeicons/react-native) - For React Native applications
- [@hugeicons/vue](https://www.npmjs.com/package/@hugeicons/vue) - For Vue applications
- [@hugeicons/angular](https://www.npmjs.com/package/@hugeicons/angular) - For Angular applications
- [@hugeicons/svelte](https://www.npmjs.com/package/@hugeicons/svelte) - For Svelte applications

Each framework package provides optimized components, additional features, and framework-specific documentation.

## Types

TypeScript types are included and will work out of the box.

## License

Created by Hugeicons. All rights reserved.
