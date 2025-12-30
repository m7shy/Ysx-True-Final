
import { Email, EmailStatus, FollowUpHistoryItem, AutoFollowUp, Lead, LeadStatus, LeadIntelligence, Thread, ThreadStatus, ThreadLeadStatus, ThreadMessage } from '../types';

// Mock data to simulate a Zoho Mail "Sent Items" folder
const INITIAL_EMAILS: Email[] = [
  {
    id: 'e1',
    recipient: 'sarah.j@techcorp.com',
    recipientName: 'Sarah Jenkins',
    company: 'TechCorp Solutions',
    subject: 'Proposal for Q3 Marketing Campaign',
    body: 'Hi Sarah,\n\nIt was great speaking with you yesterday. Attached is the proposal for the Q3 marketing campaign we discussed. We have outlined the budget and timeline as requested.\n\nLet me know if you have any questions.\n\nBest,\nAlex',
    sentDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(), // 5 days ago
    status: EmailStatus.NO_REPLY,
  },
  {
    id: 'e2',
    recipient: 'mike.chen@startuplab.io',
    recipientName: 'Mike Chen',
    company: 'StartupLab',
    subject: 'Contract Renewal - Service Agreement',
    body: 'Hello Mike,\n\nI hope this email finds you well. Our records indicate your service agreement is expiring next month. I have attached the renewal contract for your review.\n\nPlease sign and return it by the 30th.\n\nThanks,\nAlex',
    sentDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(), // 8 days ago
    status: EmailStatus.NO_REPLY,
  },
  {
    id: 'e3',
    recipient: 'diana.prince@global.org',
    recipientName: 'Diana Prince',
    company: 'Global Initiatives',
    subject: 'Re: Meeting availability next Tuesday',
    body: 'Hi Diana,\n\nThanks for the invite. Tuesday at 2 PM works perfectly for me. I will send a calendar invite shortly.\n\nSee you then,\nAlex',
    sentDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(), // 1 day ago
    status: EmailStatus.REPLIED,
  },
  {
    id: 'e4',
    recipient: 'luke.s@designstudio.net',
    recipientName: 'Luke Skywalker',
    company: 'Rebel Design',
    subject: 'Assets for the new landing page',
    body: 'Hey Luke,\n\nJust following up on the assets for the landing page. We are blocked on development until we receive the final SVGs.\n\nCould you please send them over by EOD?\n\nCheers,\nAlex',
    sentDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), // 3 days ago
    status: EmailStatus.FOLLOW_UP_DRAFTED,
  },
  {
    id: 'e5',
    recipient: 'jason@futuretech.com',
    recipientName: 'Jason Bourne',
    company: 'Treadstone Inc',
    subject: 'Project Review Meeting',
    body: 'Hi Jason,\n\nChecking in on the project status. Can we schedule a brief review later this week?\n\nThanks,\nAlex',
    sentDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    status: EmailStatus.SCHEDULED,
    scheduledDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString(), // Scheduled for 2 days from now
    followupHistory: [
      {
        date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString(),
        content: "Hi Jason,\n\nJust bumping this to the top of your inbox. Let me know if you have time for that review.\n\nBest,\nAlex",
        status: 'SCHEDULED'
      }
    ]
  },
  // Added explicit SENT emails for Style Mimicry testing
  {
    id: 'e6',
    recipient: 'tony@stark.com',
    recipientName: 'Tony Stark',
    company: 'Stark Industries',
    subject: 'Consultation Follow-up',
    body: 'Hi Tony,\n\nThanks for the time today. I loved hearing about the new reactor designs. As mentioned, I will put together a brief scope of work for the interface overhaul.\n\nExpect that by Friday.\n\nCheers,\nAlex',
    sentDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
    status: EmailStatus.SENT,
  },
  {
    id: 'e7',
    recipient: 'natasha@shield.gov',
    recipientName: 'Natasha Romanoff',
    company: 'SHIELD',
    subject: 'Q4 Report Data',
    body: 'Hey Natasha,\n\nHere is the data you requested for the Q4 report. Let me know if you need any clarification on the metrics.\n\nBest,\nAlex',
    sentDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
    status: EmailStatus.SENT,
  },
  {
    id: 'e8',
    recipient: 'steve@rogers.com',
    recipientName: 'Steve Rogers',
    company: 'Brooklyn Avengers',
    subject: 'Leadership Seminar Invite',
    body: 'Hi Steve,\n\nIt was an honor to meet you at the summit. I attached the itinerary for the leadership seminar we discussed. I think your input on team dynamics would be invaluable.\n\nHope you can make it.\n\nBest,\nAlex',
    sentDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(),
    status: EmailStatus.SENT,
  }
];

// Mock Leads Data with new Funnel Statuses
const INITIAL_LEADS: Lead[] = [
  { id: 'l1', name: 'Alice Freeman', email: 'alice@vertex.com', company: 'Vertex Inc', status: 'NEW', source: 'LinkedIn' },
  // 1 Client Closed
  { id: 'l2', name: 'Bob Smith', email: 'bob@builders.net', company: 'Builders Co', status: 'CLIENT_CLOSED', lastContacted: new Date(Date.now() - 86400000 * 15).toISOString(), source: 'Website', score: 95 },
  // 2 Trials
  { id: 'l3', name: 'Charlie Davis', email: 'charlie@delta.io', company: 'Delta Group', status: 'TRIAL', lastContacted: new Date(Date.now() - 86400000 * 5).toISOString(), source: 'Referral', score: 82 },
  { id: 'l4', name: 'Diana Ross', email: 'diana@music.com', company: 'Motown', status: 'TRIAL', lastContacted: new Date(Date.now() - 86400000 * 3).toISOString(), source: 'Direct', score: 78 },
  // 4 Calls Booked
  { id: 'l5', name: 'Dana White', email: 'dana@ufc.com', company: 'TKO Group', status: 'CALL_BOOKED', lastContacted: new Date(Date.now() - 86400000 * 1).toISOString(), source: 'Event', score: 65 },
  { id: 'l6', name: 'Evan Wright', email: 'evan@writes.com', company: 'Authors Guild', status: 'CALL_BOOKED', source: 'Cold Email', score: 70 },
  { id: 'l7', name: 'Fiona Apple', email: 'fiona@fetch.com', company: 'Fetch', status: 'CALL_BOOKED', source: 'LinkedIn', score: 68 },
  { id: 'l8', name: 'George Lucas', email: 'george@film.com', company: 'Lucasfilm', status: 'CALL_BOOKED', source: 'Referral', score: 75 },
  // Others
  { id: 'l9', name: 'Harry Potter', email: 'harry@hogwarts.edu', company: 'Ministry', status: 'CONTACTED', lastContacted: new Date(Date.now() - 86400000 * 2).toISOString(), source: 'Owl' },
  { id: 'l10', name: 'Ian Malcolm', email: 'ian@chaos.com', company: 'InGen', status: 'REPLIED', lastContacted: new Date(Date.now() - 86400000 * 4).toISOString(), source: 'Event' },
  { id: 'l11', name: 'Jack Sparrow', email: 'jack@pearl.com', company: 'Caribbean', status: 'LOST', source: 'Sea' }
];

const INITIAL_THREADS: Thread[] = [
  {
    id: 't1',
    leadId: 'l10',
    leadName: 'Ian Malcolm',
    leadEmail: 'ian@chaos.com',
    leadCompany: 'InGen',
    subject: 'Re: Chaos Theory Discussion',
    status: 'UNREAD',
    leadStatus: 'INTERESTED',
    lastMessageDate: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 mins ago
    messages: [
      { id: 'm1', sender: 'ME', content: 'Hi Ian,\n\nFollowing up on our chaos theory discussion. Are you still interested in the analysis software?', date: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
      { id: 'm2', sender: 'LEAD', content: 'Yes, actually. Life finds a way, and so do we. Can you send over a demo link?', date: new Date(Date.now() - 1000 * 60 * 30).toISOString() }
    ]
  },
  {
    id: 't2',
    leadId: 'l5',
    leadName: 'Dana White',
    leadEmail: 'dana@ufc.com',
    leadCompany: 'TKO Group',
    subject: 'Re: Sponsorship Opportunity',
    status: 'READ',
    leadStatus: 'MEETING_BOOKED',
    lastMessageDate: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), // 5 hours ago
    messages: [
      { id: 'm3', sender: 'ME', content: 'Hey Dana, any thoughts on the sponsorship deck?', date: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString() },
      { id: 'm4', sender: 'LEAD', content: 'Looks solid. Let\'s book a call to discuss the financials.', date: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
      { id: 'm5', sender: 'ME', content: 'Great. How is Tuesday at 10am?', date: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString() },
      { id: 'm6', sender: 'LEAD', content: 'Tuesday works. Send the invite.', date: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() }
    ]
  },
  {
    id: 't3',
    leadId: 'l8',
    leadName: 'George Lucas',
    leadEmail: 'george@film.com',
    leadCompany: 'Lucasfilm',
    subject: 'Re: Special Effects Tools',
    status: 'UNREAD',
    leadStatus: 'LEFT_HANGING',
    lastMessageDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(), // 2 days ago
    messages: [
      { id: 'm7', sender: 'ME', content: 'George, did you get a chance to see the new VFX plugin demo?', date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString() },
      { id: 'm8', sender: 'LEAD', content: 'I did. It\'s interesting but lacks the grit I need. It\'s too... digital.', date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString() }
    ]
  },
  {
    id: 't4',
    leadId: 'l4',
    leadName: 'Diana Ross',
    leadEmail: 'diana@music.com',
    leadCompany: 'Motown',
    subject: 'Re: Sound Engineering Consultation',
    status: 'READ',
    leadStatus: 'NOT_INTERESTED',
    lastMessageDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(), // 7 days ago
    messages: [
      { id: 'm9', sender: 'ME', content: 'Hi Diana, just checking in on the sound engineering proposal.', date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString() },
      { id: 'm10', sender: 'LEAD', content: 'Thank you Alex, but we have decided to go with an internal team for now. I appreciate your time.', date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString() }
    ]
  },
  {
    id: 't5',
    leadId: 'l2',
    leadName: 'Bob Smith',
    leadEmail: 'bob@builders.net',
    leadCompany: 'Builders Co',
    subject: 'Re: Project Alpha Kickoff',
    status: 'READ',
    leadStatus: 'INTERESTED',
    lastMessageDate: new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString(), // 1 hour ago
    messages: [
      { id: 'm11', sender: 'ME', content: 'Bob, ready to get started on Project Alpha?', date: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
      { id: 'm12', sender: 'LEAD', content: 'Almost. Just waiting on the final permit. Should be today.', date: new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString() }
    ]
  }
];

// --- Local Storage Helpers ---
const loadFromStorage = <T>(key: string, defaultData: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultData;
  } catch (e) {
    console.error(`Error loading ${key} from storage`, e);
    return defaultData;
  }
};

const saveToStorage = (key: string, data: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error(`Error saving ${key} to storage`, e);
  }
};

// Mutable in-memory store initialized from LocalStorage
let mockEmails: Email[] = loadFromStorage('zoho_mock_emails', INITIAL_EMAILS);
let mockLeads: Lead[] = loadFromStorage('zoho_mock_leads', INITIAL_LEADS);
let mockThreads: Thread[] = loadFromStorage('zoho_mock_threads', INITIAL_THREADS);

// Simulate network delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const fetchSentEmails = async (): Promise<Email[]> => {
  await delay(800); // Simulate API latency
  return [...mockEmails];
};

export const getLastEmailSnippet = async (emailAddress: string): Promise<string | null> => {
  await delay(200); // Short delay
  const sent = mockEmails.filter(e => e.recipient.toLowerCase() === emailAddress.toLowerCase());
  if (sent.length === 0) return null;
  // Sort by date desc
  sent.sort((a, b) => new Date(b.sentDate).getTime() - new Date(a.sentDate).getTime());
  const last = sent[0];
  // return snippet
  const snippet = last.body.replace(/\n/g, ' ').substring(0, 100);
  return snippet + (last.body.length > 100 ? '...' : '');
};

export const sendNewEmail = async (
  to: string, 
  name: string, 
  company: string, 
  subject: string, 
  body: string,
  autoFollowUps?: AutoFollowUp[]
): Promise<Email> => {
  await delay(1000);
  const newEmail: Email = {
    id: `new_${Date.now()}`,
    recipient: to,
    recipientName: name,
    company: company,
    subject: subject,
    body: body,
    sentDate: new Date().toISOString(),
    status: EmailStatus.NO_REPLY,
    autoFollowUps: autoFollowUps
  };
  // Add to the beginning of the list
  mockEmails.unshift(newEmail);
  saveToStorage('zoho_mock_emails', mockEmails); // Save Emails

  console.log(`[Simulated Zoho API] Sent new email to ${to}`);
  
  // Update Lead status if email matches
  const lead = mockLeads.find(l => l.email === to);
  if (lead) {
    lead.status = 'CONTACTED';
    lead.lastContacted = new Date().toISOString();
    // We need to trigger a re-render or save the leads as well since we modified one
    mockLeads = mockLeads.map(l => l.id === lead.id ? lead : l);
    saveToStorage('zoho_mock_leads', mockLeads); // Save Leads
  }

  if (autoFollowUps && autoFollowUps.length > 0) {
    console.log(`[Simulated Zoho API] Configured ${autoFollowUps.length} auto-follow-ups.`);
  }
  return newEmail;
};

export const sendFollowUpEmail = async (emailId: string, content: string, scheduledDate?: string): Promise<boolean> => {
  await delay(1500);
  
  const email = mockEmails.find(e => e.id === emailId);
  if (!email) return false;

  const historyItem: FollowUpHistoryItem = {
    date: scheduledDate || new Date().toISOString(),
    content: content,
    status: scheduledDate ? 'SCHEDULED' : 'SENT'
  };

  if (!email.followupHistory) {
    email.followupHistory = [];
  }
  email.followupHistory.push(historyItem);

  if (scheduledDate) {
    console.log(`[Simulated Zoho API] Scheduling email for ID ${emailId} on ${scheduledDate}:`, content);
    email.status = EmailStatus.SCHEDULED;
    email.scheduledDate = scheduledDate;
  } else {
    console.log(`[Simulated Zoho API] Sending email to ID ${emailId}:`, content);
    email.status = EmailStatus.FOLLOW_UP_SENT;
    
    // Update lead status too
    const lead = mockLeads.find(l => l.email === email.recipient);
    if (lead) {
       lead.lastContacted = new Date().toISOString();
       mockLeads = mockLeads.map(l => l.id === lead.id ? lead : l);
       saveToStorage('zoho_mock_leads', mockLeads); // Save Leads
    }
  }
  
  saveToStorage('zoho_mock_emails', mockEmails); // Save Emails
  return true;
};

// Lead Management Functions
export const fetchLeads = async (): Promise<Lead[]> => {
  await delay(600);
  return [...mockLeads];
};

export const addLead = async (leadData: Omit<Lead, 'id'>): Promise<Lead> => {
  await delay(800);
  const newLead: Lead = { ...leadData, id: `l${Date.now()}` };
  mockLeads.unshift(newLead);
  saveToStorage('zoho_mock_leads', mockLeads); // Save Leads
  return newLead;
};

export const updateLeadStatus = async (id: string, status: LeadStatus): Promise<void> => {
  await delay(400);
  mockLeads = mockLeads.map(l => l.id === id ? { ...l, status } : l);
  saveToStorage('zoho_mock_leads', mockLeads); // Save Leads
};

export const updateLeadNotes = async (id: string, notes: string): Promise<void> => {
  await delay(500);
  mockLeads = mockLeads.map(l => l.id === id ? { ...l, notes } : l);
  saveToStorage('zoho_mock_leads', mockLeads); // Save Leads
};

export const deleteLead = async (id: string): Promise<void> => {
  await delay(500);
  mockLeads = mockLeads.filter(l => l.id !== id);
  saveToStorage('zoho_mock_leads', mockLeads); // Save Leads
};

export const analyzeLead = async (leadId: string): Promise<Lead> => {
  await delay(1500); // Simulate AI analysis delay
  const lead = mockLeads.find(l => l.id === leadId);
  if (!lead) throw new Error("Lead not found");

  // Generate random intelligence data
  const postingFrequencies: LeadIntelligence['postingFrequency'][] = ['DAILY', 'WEEKLY', 'MONTHLY', 'SPORADIC'];
  const offerTypes: LeadIntelligence['offerType'][] = ['HIGH_TICKET', 'COURSE', 'CONSULTING', 'SAAS'];
  const keywords = ['Growth', 'Marketing', 'Sales', 'AI', 'Automation', 'Leadership'];

  const intelligence: LeadIntelligence = {
    postingFrequency: postingFrequencies[Math.floor(Math.random() * postingFrequencies.length)],
    hasPaidCommunity: Math.random() > 0.5,
    offerType: offerTypes[Math.floor(Math.random() * offerTypes.length)],
    targetKeywords: [keywords[Math.floor(Math.random() * keywords.length)], keywords[Math.floor(Math.random() * keywords.length)]],
    lastPostDate: new Date(Date.now() - Math.floor(Math.random() * 90) * 86400000).toISOString()
  };

  // Calculate Score
  let score = 0;
  
  // +30 if hasPaidCommunity is true
  if (intelligence.hasPaidCommunity) score += 30;

  // +20 if postingFrequency is 'DAILY' or 'WEEKLY'
  if (intelligence.postingFrequency === 'DAILY' || intelligence.postingFrequency === 'WEEKLY') score += 20;

  // +20 if offerType is 'HIGH_TICKET'
  if (intelligence.offerType === 'HIGH_TICKET') score += 20;

  // -10 if lastPostDate is > 60 days ago
  const daysSincePost = (Date.now() - new Date(intelligence.lastPostDate).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSincePost > 60) score -= 10;

  // Add base randomness to make it realistic (between 10 and 40)
  score += Math.floor(Math.random() * 30) + 10;

  // Cap at 100
  score = Math.min(Math.max(score, 0), 100);

  // Update the lead in the mock store
  lead.score = score;
  lead.intelligence = intelligence;

  // Update global mockLeads
  mockLeads = mockLeads.map(l => l.id === leadId ? lead : l);
  saveToStorage('zoho_mock_leads', mockLeads); // Save Leads

  return lead;
};

export const getFunnelMetrics = async () => {
  await delay(300);
  
  // DMs Sent: Count of leads with status CONTACTED or higher (Anything not 'NEW' or 'LOST', roughly)
  // To be precise with the funnel:
  const activeStatuses = ['CONTACTED', 'REPLIED', 'CALL_BOOKED', 'TRIAL', 'CLIENT_CLOSED'];
  const dmsSent = mockLeads.filter(l => activeStatuses.includes(l.status) || l.status === 'LOST').length; 

  // Replies: Count of emails with status REPLIED (from email store)
  const replies = mockEmails.filter(e => e.status === EmailStatus.REPLIED).length;
  
  // Funnel stages from leads
  const callsBooked = mockLeads.filter(l => ['CALL_BOOKED', 'TRIAL', 'CLIENT_CLOSED'].includes(l.status)).length;
  const trials = mockLeads.filter(l => ['TRIAL', 'CLIENT_CLOSED'].includes(l.status)).length;
  const clients = mockLeads.filter(l => l.status === 'CLIENT_CLOSED').length;

  return { dmsSent, replies, callsBooked, trials, clients };
};

// --- Thread Functions ---

export const fetchInboxThreads = async (): Promise<Thread[]> => {
  await delay(500);
  // Sort by last message date desc
  return [...mockThreads].sort((a, b) => new Date(b.lastMessageDate).getTime() - new Date(a.lastMessageDate).getTime());
};

export const sendReplyToThread = async (threadId: string, content: string): Promise<Thread> => {
  await delay(800);
  const thread = mockThreads.find(t => t.id === threadId);
  if (!thread) throw new Error("Thread not found");

  const newMessage: ThreadMessage = {
    id: `m_${Date.now()}`,
    sender: 'ME',
    content: content,
    date: new Date().toISOString()
  };

  thread.messages.push(newMessage);
  thread.lastMessageDate = newMessage.date;
  
  // Update mock store
  mockThreads = mockThreads.map(t => t.id === threadId ? thread : t);
  saveToStorage('zoho_mock_threads', mockThreads);
  
  return thread;
};

export const updateThreadStatus = async (threadId: string, status: ThreadStatus): Promise<void> => {
  await delay(200);
  const thread = mockThreads.find(t => t.id === threadId);
  if (thread) {
    thread.status = status;
    saveToStorage('zoho_mock_threads', mockThreads);
  }
};

export const updateThreadLeadStatus = async (threadId: string, status: ThreadLeadStatus): Promise<void> => {
  await delay(300);
  const thread = mockThreads.find(t => t.id === threadId);
  if (thread) {
    thread.leadStatus = status;
    saveToStorage('zoho_mock_threads', mockThreads);
  }
};
