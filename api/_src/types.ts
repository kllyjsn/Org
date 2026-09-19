export type BuyingRole =
  | 'champion'
  | 'economic_buyer'
  | 'decision_maker'
  | 'technical_buyer'
  | 'influencer'
  | 'blocker'
  | 'none';

export type Confidence = 'high' | 'medium' | 'low';

export interface ResearchSource {
  url: string;
  title: string | null;
  publisher: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  sourceType:
    | 'official'
    | 'filing'
    | 'press'
    | 'news'
    | 'profile'
    | 'job'
    | 'conference'
    | 'other';
}

export interface Person {
  id: string;
  name: string;
  title: string;
  department: string | null;
  team?: string | null;
  productLine?: string | null;
  teamEvidence?: 'sourced' | 'inferred' | null;
  role: BuyingRole;
  confidence: Confidence;
  sources: string[];
  sourceDetails?: ResearchSource[];
  freshness?: 'fresh' | 'aging' | 'stale' | 'unknown';
  corroborationCount?: number;
  lastVerifiedAt?: string | null;
  conflictingTitles?: string[];
  researchStatus?: 'verified' | 'possibly_stale' | 'conflicting';
  notes: string;
  /** Marked when the user has met this person (meeting import / panel). */
  metWith?: boolean;
  email: string | null;
  linkedin: string | null;
  jobLevel?: string | null;
  groupId?: string;
  x: number;
  y: number;
}

export interface CompanyProfile {
  companyName: string | null;
  description: string | null;
  mission: string | null;
  headquarters: string | null;
  annualRevenue: string | null;
  annualRevenueUsd: number | null;
  employeeCount: number | null;
  engineerCount: number | null;
  industry: string | null;
  fiscalYearEndMonth: number | null;
  linkedinUrl: string | null;
  annualReportUrl: string | null;
  funding: string | null;
  sources: string[];
  retrievedAt: string;
}

export interface MapEdge {
  id: string;
  from: string; // manager person id
  to: string; // report person id
  kind: 'reports' | 'influence';
  label: string | null;
  inferred?: boolean; // title-seniority guess, not sourced reporting data
}

export interface MapMeta {
  domain: string;
  companyName: string | null;
  researchedAt: string | null;
  tier: string; // e.g. "T0"
  provider: string | null; // llm provider used for research
  refreshCadence?: 'weekly' | 'monthly' | 'manual';
  nextRefreshAt?: string | null;
  initiatives?: StrategicInitiative[];
  strategy?: AccountStrategyPlan;
  companyProfile?: CompanyProfile | null;
}

export type Stance = 'advocate' | 'neutral' | 'skeptic' | 'unknown';
export interface StakeholderPlanEntry {
  stance: Stance;
  nextStep: string;
  note: string;
}
export interface StrategyTask {
  id: string;
  title: string;
  done: boolean;
  personId?: string;
  source: 'generated' | 'manual';
  createdAt: string;
}
export interface AccountStrategyPlan {
  entryPersonId?: string | null;
  targetPersonId?: string | null;
  stakeholders: Record<string, StakeholderPlanEntry>;
  tasks: StrategyTask[];
  updatedAt: string;
}

export interface StrategicInitiative {
  name: string;
  summary: string;
  category: 'product' | 'growth' | 'operations' | 'technology' | 'market';
  evidence: string[];
  evidenceDetails?: ResearchSource[];
  relevantPeople: string[];
  relevantTeams: string[];
  salesAngles: string[];
}

export interface MapState {
  people: Person[];
  edges: MapEdge[];
  meta: MapMeta;
  groups?: MapGroup[];
}

export interface MapGroup {
  id: string;
  name: string;
  parentGroupId: string | null;
  function?: string | null;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
  email_verified_at?: string | null;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  created_by: string;
  plan: 'free' | 'pro';
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  seller_profile: SellerProfile | null;
  created_at: string;
}

export interface SellerProfile {
  companyName: string;
  domain: string;
  summary: string;
  products: string[];
  targetCustomers: string[];
  useCases: string[];
  proofPoints: string[];
  competitors: string[];
  positioning: string;
  researchedAt: string;
}

export interface MemberRow {
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'member' | 'viewer';
  access_scope: 'all' | 'selected';
  created_at: string;
}

export interface MapRow {
  id: string;
  workspace_id: string;
  name: string;
  domain: string;
  company_name: string | null;
  state: MapState;
  is_live_opportunity: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ShareLinkRow {
  token: string;
  map_id: string;
  created_by: string;
  expires_at: string | null;
  created_at: string;
}
