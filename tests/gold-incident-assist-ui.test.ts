import { describe, expect, it } from 'vitest';
import {
  defaultGroupingPaneState,
  groupingPaneBodyScript,
  renderGroupingPane,
} from '../src/review/grouping/grouping-eval-page.js';

describe('Grouping eval pane — Assist UI markup', () => {
  it('renders the Assist button and draft container', () => {
    const html = renderGroupingPane();
    expect(html).toContain('id="grp-assist"');
    expect(html).toContain('>Assist</button>');
    expect(html).toContain('id="grp-assist-draft"');
  });

  it('exposes the default grouping state shape', () => {
    const state = defaultGroupingPaneState();
    expect(state.subtab).toBe('incidents');
    expect(state.basket).toEqual([]);
  });

  it('clears assist draft when the basket or incident selection changes', () => {
    const script = groupingPaneBodyScript();
    expect(script).toContain('function clearAssistDraft()');
    expect(script).toMatch(/clearAssistDraft\(\);[\s\S]*renderBasket\(\);[\s\S]*renderExpanded\(\);/);
    expect(script).not.toContain("console.log('[assist] articleIds'");
  });
});