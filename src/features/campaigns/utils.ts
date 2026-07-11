import { CsvData, Lead, MappingField } from './types';

// Minimal CSV parser that supports quoted fields, escaped quotes, and commas
// inside quotes. Suitable for the CSVs this wizard accepts.
export function parseCsv(text: string): CsvData {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    current.push(field);
    field = '';
  };
  const pushRow = () => {
    // Ignore fully blank trailing rows.
    if (current.length === 1 && current[0] === '') {
      current = [];
      return;
    }
    rows.push(current);
    current = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      pushField();
      continue;
    }
    if (ch === '\r') continue;
    if (ch === '\n') {
      pushField();
      pushRow();
      continue;
    }
    field += ch;
  }
  // Flush trailing field/row.
  if (field.length > 0 || current.length > 0) {
    pushField();
    pushRow();
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ''));
  return { headers, rows: dataRows };
}

const FIELD_TO_KEY: Partial<Record<MappingField, keyof Lead>> = {
  first_name: 'first_name',
  last_name: 'last_name',
  email: 'email',
  phone: 'phone',
  company: 'company',
  website: 'website',
  linkedin: 'linkedin',
  location: 'location',
};

export function buildLeads(
  csv: CsvData,
  mapping: Record<string, MappingField>
): Lead[] {
  return csv.rows.map((row) => {
    const lead: Lead = { email: '', custom: {} };
    csv.headers.forEach((header, idx) => {
      const value = (row[idx] ?? '').trim();
      lead.custom[header] = value;
      const field = mapping[header];
      if (!field || field === 'ignore') return;
      const canonical = FIELD_TO_KEY[field];
      if (canonical) {
        (lead as Record<string, unknown>)[canonical] = value;
      }
    });
    return lead;
  });
}

// Render a string template, replacing {{variable}} tokens with values from the
// lead's merged variable map. Unknown variables are left visible as [variable].
export function renderTemplate(template: string, lead: Lead): string {
  const vars = leadVariables(lead);
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name) => {
    const v = vars[name];
    return v !== undefined && v !== '' ? v : `[${name}]`;
  });
}

export function leadVariables(lead: Lead): Record<string, string> {
  return {
    first_name: lead.first_name ?? '',
    last_name: lead.last_name ?? '',
    email: lead.email,
    phone: lead.phone ?? '',
    company: lead.company ?? '',
    website: lead.website ?? '',
    linkedin: lead.linkedin ?? '',
    location: lead.location ?? '',
    ...lead.custom,
  };
}

// Tokenise a template into alternating plain-text and variable tokens. Used by
// the highlighted editor to render variables as pill-like spans.
export type TemplateToken =
  | { kind: 'text'; value: string }
  | { kind: 'var'; value: string };

export function tokenizeTemplate(template: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', value: template.slice(lastIndex, match.index) });
    }
    tokens.push({ kind: 'var', value: match[1] });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < template.length) {
    tokens.push({ kind: 'text', value: template.slice(lastIndex) });
  }
  return tokens;
}
