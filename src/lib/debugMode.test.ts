import { describe, expect, it } from 'vitest';
import { debugFromSearch, withDebugParam } from './debugMode';

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

describe('debugFromSearch', () => {
  it('turns debug mode on for debug=1 alone', () => {
    expect(debugFromSearch('?debug=1')).toBe(true);
    expect(debugFromSearch('?ll=1,2&debug=1')).toBe(true);
  });

  it('leaves it off when the param is missing or anything but 1', () => {
    expect(debugFromSearch('')).toBe(false);
    expect(debugFromSearch('?ll=1,2')).toBe(false);
    expect(debugFromSearch('?debug=0')).toBe(false);
    expect(debugFromSearch('?debug=')).toBe(false);
  });
});
