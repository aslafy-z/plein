import { describe, expect, it } from 'vitest';
import { withDebugParam } from './debugMode';

describe('withDebugParam', () => {
  it('leaves the url alone while debug mode is off', () => {
    expect(withDebugParam('/station/fr-1', false)).toBe('/station/fr-1');
    expect(withDebugParam('/?ll=1,2&z=12', false)).toBe('/?ll=1,2&z=12');
  });

  it('starts a query on a bare path', () => {
    expect(withDebugParam('/station/fr-31500007', true)).toBe('/station/fr-31500007?debug=1');
  });

  it('appends to an existing query', () => {
    expect(withDebugParam('/?ll=1,2&z=12', true)).toBe('/?ll=1,2&z=12&debug=1');
  });
});
