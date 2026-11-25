/**
 * File menu: `iconOnly` hides the visible label but keeps it as the button's
 * accessible name, so a host toolbar can collapse it on a narrow screen.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FileMenu } from '../../src/components/FileMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(el: React.ReactElement): HTMLButtonElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host.querySelector('button')!;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('FileMenu', () => {
  it('shows its label by default', () => {
    const btn = mount(<FileMenu />);
    expect(btn.textContent).toBe('File');
    expect(btn.getAttribute('aria-label')).toBeNull();
  });

  it('iconOnly keeps the label as the accessible name and tooltip', () => {
    const btn = mount(<FileMenu iconOnly />);
    expect(btn.textContent).toBe('');
    expect(btn.getAttribute('aria-label')).toBe('File');
    expect(btn.getAttribute('title')).toBe('File');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
  });
});
