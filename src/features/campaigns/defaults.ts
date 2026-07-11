import {
  CampaignSettings,
  MappingField,
  MappingOption,
  ScheduleConfig,
  SequenceStage,
} from './types';

export const MAPPING_OPTIONS: MappingOption[] = [
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name', label: 'Last Name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'company', label: 'Company Name' },
  { value: 'website', label: 'Website' },
  { value: 'linkedin', label: 'LinkedIn Profile' },
  { value: 'location', label: 'Location' },
  { value: 'custom', label: 'Custom Field' },
  { value: 'ignore', label: 'Ignore Field' },
];

// Best-effort auto-mapping by normalised header name.
const AUTO_MAP: Record<string, MappingField> = {
  first_name: 'first_name',
  firstname: 'first_name',
  fname: 'first_name',
  last_name: 'last_name',
  lastname: 'last_name',
  lname: 'last_name',
  email: 'email',
  email_address: 'email',
  e_mail: 'email',
  phone: 'phone',
  phone_number: 'phone',
  mobile: 'phone',
  company: 'company',
  company_name: 'company',
  organization: 'company',
  website: 'website',
  url: 'website',
  linkedin: 'linkedin',
  linkedin_profile: 'linkedin',
  location: 'location',
  city: 'location',
  country: 'location',
};

export function autoMap(header: string): MappingField {
  const key = header.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (AUTO_MAP[key]) return AUTO_MAP[key];
  return 'custom';
}

// Main email + up to 2 default follow-ups (waitDays is DAYS SINCE THE
// PREVIOUS STEP, not cumulative — CampaignWizard converts this to the
// backend's autoFollowUps[].delay, which is also relative-to-previous).
// So "at +2 and +5 days total" is waitDays 2, then 3.
export const DEFAULT_SEQUENCE: SequenceStage[] = [
  {
    id: 'stage-1',
    label: 'Main Email',
    waitDays: 0,
    isThreadReply: false,
    variants: [
      {
        id: 'stage-1-a',
        subject: 'Quick question, {{first_name}}',
        body: `hey {{first_name}},

`,
      },
    ],
  },
  {
    id: 'stage-2',
    label: 'Follow-up 1',
    waitDays: 2,
    isThreadReply: true,
    variants: [
      {
        id: 'stage-2-a',
        subject: '-----',
        body: `hey {{first_name}}, just following up on this — did you get a chance to see it?`,
      },
    ],
  },
  {
    id: 'stage-3',
    label: 'Follow-up 2',
    waitDays: 3,
    isThreadReply: true,
    variants: [
      {
        id: 'stage-3-a',
        subject: '-----',
        body: `hey {{first_name}}, i'll leave it here — if it's not a fit right now, no worries.`,
      },
    ],
  },
];

export const MAX_FOLLOW_UPS = 3;

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  timezone: 'America/Los_Angeles',
  sendDays: {
    mon: true,
    tue: true,
    wed: true,
    thu: true,
    fri: true,
    sat: false,
    sun: false,
  },
  startTime: '09:00',
  endTime: '18:00',
  intervalMinutes: 20,
  maxNewLeadsPerDay: 100,
};

export const DEFAULT_SETTINGS: CampaignSettings = {
  followUpPercent: 50,
  stopOnReply: true,
  stopOnClick: false,
  stopOnOpen: false,
  plainTextMode: false,
};

export const TIMEZONE_OPTIONS = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];
