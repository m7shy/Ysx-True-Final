// FILE: server/src/campaigns/variables.ts
//
// Per-lead {{variable}} interpolation for campaign subject/body templates.
// Variables resolve from: canonical Lead fields, Lead.customFields (raw CSV
// columns from the wizard's import step), and Lead.intelligence. Ordering
// with spintax (see spintax.ts): resolveSpintax runs FIRST, then
// renderTemplate — and renderTemplate strips `{`/`}` from substituted values
// so CSV data can never inject spintax syntax.

import type { Lead } from '@prisma/client';

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function firstName(name: string | null | undefined): string {
  if (!name) return '';
  return name.trim().split(/\s+/)[0] ?? '';
}

/** Build the flat variable -> value map for a lead, keys normalized. */
export function buildVariableMap(lead: Pick<Lead, 'name' | 'email' | 'company' | 'customFields' | 'intelligence'>): Record<string, string> {
  const map: Record<string, string> = {
    first_name: firstName(lead.name),
    name: lead.name ?? '',
    email: lead.email ?? '',
    company: lead.company ?? '',
  };

  const mergeJson = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      const key = normalizeKey(k);
      // Don't let arbitrary CSV columns clobber canonical identity fields.
      if (key in map && map[key]) continue;
      map[key] = typeof v === 'string' ? v : JSON.stringify(v);
    }
  };

  mergeJson(lead.intelligence);
  mergeJson(lead.customFields);

  return map;
}

const VARIABLE_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Strip braces from a value so substituted content can't itself be treated as a variable/spintax token. */
function stripBraces(value: string): string {
  return value.replace(/[{}]/g, '');
}

/**
 * Replace {{variable}} tokens in `tpl` using the lead's variable map.
 * Unknown variables resolve to an empty string (and are logged for debugging).
 */
export function renderTemplate(tpl: string, lead: Pick<Lead, 'name' | 'email' | 'company' | 'customFields' | 'intelligence'>): string {
  if (!tpl) return tpl;
  const vars = buildVariableMap(lead);
  return tpl.replace(VARIABLE_RE, (full, rawKey: string) => {
    const key = normalizeKey(rawKey);
    const value = vars[key];
    if (value === undefined) {
      console.debug(`[campaigns/variables] unknown template variable "${rawKey}" (lead ${lead.email})`);
      return '';
    }
    return stripBraces(value);
  });
}
