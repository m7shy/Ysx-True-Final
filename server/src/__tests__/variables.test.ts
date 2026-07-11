import { describe, it, expect } from 'vitest';
import { renderTemplate, buildVariableMap } from '../campaigns/variables.js';
import { resolveSpintax } from '../campaigns/spintax.js';

function lead(overrides: Partial<Parameters<typeof renderTemplate>[1]> = {}) {
  return {
    name: 'Jamie Rivera',
    email: 'jamie@example.com',
    company: 'Acme Inc',
    customFields: null,
    intelligence: null,
    ...overrides,
  } as Parameters<typeof renderTemplate>[1];
}

describe('buildVariableMap', () => {
  it('derives first_name from the first token of name', () => {
    const map = buildVariableMap(lead());
    expect(map.first_name).toBe('Jamie');
    expect(map.name).toBe('Jamie Rivera');
    expect(map.email).toBe('jamie@example.com');
    expect(map.company).toBe('Acme Inc');
  });

  it('merges customFields and intelligence, normalizing headers', () => {
    const map = buildVariableMap(
      lead({
        customFields: { 'Timestamp 1': '0:42', 'problem-1': 'jump cut' },
        intelligence: { offerType: 'SAAS' },
      }),
    );
    expect(map.timestamp_1).toBe('0:42');
    expect(map.problem_1).toBe('jump cut');
    expect(map.offertype).toBe('SAAS');
  });

  it('does not let a custom field clobber a canonical identity field', () => {
    const map = buildVariableMap(lead({ customFields: { email: 'attacker@evil.com' } }));
    expect(map.email).toBe('jamie@example.com');
  });
});

describe('renderTemplate', () => {
  it('substitutes known variables', () => {
    const out = renderTemplate('hey {{first_name}}, saw your video at {{timestamp_1}}', lead({ customFields: { timestamp_1: '1:23' } }));
    expect(out).toBe('hey Jamie, saw your video at 1:23');
  });

  it('is case/whitespace insensitive on variable names', () => {
    const out = renderTemplate('{{ First_Name }}', lead());
    expect(out).toBe('Jamie');
  });

  it('resolves an unknown variable to an empty string', () => {
    const out = renderTemplate('hi {{nonexistent_field}}!', lead());
    expect(out).toBe('hi !');
  });

  it('strips braces from substituted values so they cannot inject further template syntax', () => {
    const out = renderTemplate('{{first_name}}', lead({ customFields: { first_name: '{{malicious}}' } }));
    // canonical first_name wins over the customFields override (see clobber test above),
    // so exercise brace-stripping through a field that isn't canonical instead.
    const out2 = renderTemplate('{{note}}', lead({ customFields: { note: 'a {b} c' } }));
    expect(out2).toBe('a b c');
    expect(out).toBe('Jamie');
  });

  it('runs after spintax, leaving {{variable}} untouched by spintax resolution', () => {
    const template = '{Hi|Hey} {{first_name}}';
    const afterSpintax = resolveSpintax(template);
    expect(afterSpintax).toMatch(/^(Hi|Hey) \{\{first_name\}\}$/);
    const out = renderTemplate(afterSpintax, lead());
    expect(out).toMatch(/^(Hi|Hey) Jamie$/);
  });
});
