/**
 * chunk 81 — React 19 + @types/react 19 dropped the global `JSX`
 * namespace; it now lives at `React.JSX`. Existing code uses
 * `JSX.Element` return-type annotations across ~14 components — bulk
 * file-by-file rewrite is friction. This shim re-exposes the React
 * JSX namespace as global so legacy `JSX.Element` etc. resolve.
 *
 * Long-term: migrate sites to `import type { JSX } from 'react'` or
 * use `React.JSX.Element` explicitly. The shim is harmless either way
 * (it just re-points `JSX` at the React-owned namespace).
 */
import type { JSX as ReactJSX } from 'react';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    type Element = ReactJSX.Element;
    type ElementClass = ReactJSX.ElementClass;
    type ElementAttributesProperty = ReactJSX.ElementAttributesProperty;
    type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute;
    type LibraryManagedAttributes<C, P> = ReactJSX.LibraryManagedAttributes<
      C,
      P
    >;
    type IntrinsicAttributes = ReactJSX.IntrinsicAttributes;
    type IntrinsicClassAttributes<T> = ReactJSX.IntrinsicClassAttributes<T>;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
  }
}
