
export interface Project {
  id: string;
  clientName: string;
  fee: number;
  hoursLogged: number;
  revisions: number;
  type: 'Short' | 'Long' | 'Documentary' | 'Ad' | 'Music Video';
  date: string;
  status: 'Active' | 'Completed';
}

export interface TierList {
  S: Project[];
  A: Project[];
  B: Project[];
  C: Project[];
  D: Project[];
  F: Project[];
}

export interface EfficiencyStats {
  totalRevenue: number;
  totalHours: number;
  avgHourlyRate: number;
  activeProjectsCount: number;
  tiers: TierList;
  bottleneck: {
    worstType: string;
    avgRevisions: number;
  };
}

// Mock Data representing a month of editing work
const MOCK_PROJECTS: Project[] = [
  { id: 'p1', clientName: 'TechStart Inc', fee: 2500, hoursLogged: 8, revisions: 1, type: 'Ad', date: '2023-10-01', status: 'Completed' }, // $312/hr (S)
  { id: 'p2', clientName: 'Indie Docu', fee: 5000, hoursLogged: 120, revisions: 12, type: 'Documentary', date: '2023-10-05', status: 'Active' }, // $41/hr (D)
  { id: 'p3', clientName: 'Crypto Bro', fee: 300, hoursLogged: 15, revisions: 8, type: 'Short', date: '2023-10-10', status: 'Completed' }, // $20/hr (F)
  { id: 'p4', clientName: 'Luxury Estate', fee: 1200, hoursLogged: 6, revisions: 2, type: 'Ad', date: '2023-10-12', status: 'Completed' }, // $200/hr (S)
  { id: 'p5', clientName: 'Gaming Channel', fee: 400, hoursLogged: 4, revisions: 1, type: 'Long', date: '2023-10-15', status: 'Completed' }, // $100/hr (B)
  { id: 'p6', clientName: 'Music Label X', fee: 1500, hoursLogged: 20, revisions: 5, type: 'Music Video', date: '2023-10-18', status: 'Completed' }, // $75/hr (C)
  { id: 'p7', clientName: 'SaaS Corp', fee: 3000, hoursLogged: 20, revisions: 2, type: 'Ad', date: '2023-10-20', status: 'Active' }, // $150/hr (A)
  { id: 'p8', clientName: 'Vlogger Daily', fee: 200, hoursLogged: 2, revisions: 0, type: 'Short', date: '2023-10-22', status: 'Completed' }, // $100/hr (B)
];

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const getEfficiencyStats = async (): Promise<EfficiencyStats> => {
  await delay(800); // Simulate calculation latency

  let totalRevenue = 0;
  let totalHours = 0;
  let activeProjectsCount = 0;
  const tiers: TierList = { S: [], A: [], B: [], C: [], D: [], F: [] };

  // Type Analysis for Bottlenecks
  const typeRevisions: Record<string, { count: number, revisions: number }> = {};

  MOCK_PROJECTS.forEach(p => {
    totalRevenue += p.fee;
    totalHours += p.hoursLogged;
    if (p.status === 'Active') activeProjectsCount++;

    // Hourly Calculation
    const hourly = p.hoursLogged > 0 ? p.fee / p.hoursLogged : 0;

    // Tiering Logic
    if (hourly >= 200) tiers.S.push(p);
    else if (hourly >= 125) tiers.A.push(p);
    else if (hourly >= 80) tiers.B.push(p);
    else if (hourly >= 50) tiers.C.push(p);
    else if (hourly >= 30) tiers.D.push(p);
    else tiers.F.push(p);

    // Bottleneck Data
    if (!typeRevisions[p.type]) typeRevisions[p.type] = { count: 0, revisions: 0 };
    typeRevisions[p.type].count++;
    typeRevisions[p.type].revisions += p.revisions;
  });

  // Calculate Bottleneck
  let worstType = '';
  let maxAvgRev = 0;

  Object.keys(typeRevisions).forEach(type => {
    const avg = typeRevisions[type].revisions / typeRevisions[type].count;
    if (avg > maxAvgRev) {
      maxAvgRev = avg;
      worstType = type;
    }
  });

  return {
    totalRevenue,
    totalHours,
    avgHourlyRate: totalHours > 0 ? totalRevenue / totalHours : 0,
    activeProjectsCount,
    tiers,
    bottleneck: {
      worstType,
      avgRevisions: maxAvgRev
    }
  };
};

export const getRecentProjects = async (): Promise<Project[]> => {
  await delay(500);
  return [...MOCK_PROJECTS].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};
