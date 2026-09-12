export type BuyingRole =
  | 'champion'
  | 'economic_buyer'
  | 'decision_maker'
  | 'technical_buyer'
  | 'influencer'
  | 'blocker'
  | 'none';

export type Confidence = 'high' | 'medium' | 'low';

export interface Person {
  id: string;
  name: string;
  title: string;
  department: string | null;
  role: BuyingRole;
  confidence: Confidence;
  sources: string[];
  notes: string;
  email: string | null;
  linkedin: string | null;
  x: number;
  y: number;
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  kind: 'reports' | 'influence';
  label: string | null;
}

export interface MapMeta {
  domain: string;
  companyName: string | null;
  researchedAt: string | null;
  tier: string;
  provider: string | null;
}

export interface MapState {
  people: Person[];
  edges: MapEdge[];
  meta: MapMeta;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface Workspace {
  id: string;
  name: string;
  role: 'owner' | 'member' | 'viewer';
}

export interface MapListItem {
  id: string;
  name: string;
  domain: string;
  company_name: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  peopleCount: number;
}

export interface LoadedMap {
  id: string;
  workspace_id: string;
  name: string;
  domain: string;
  company_name: string | null;
  state: MapState;
  role: 'owner' | 'member' | 'viewer';
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ResearchedPerson {
  name: string;
  title: string;
  department: string | null;
  reportsToName: string | null;
  confidence: Confidence;
  source: string | null;
}

export interface ResearchResult {
  companyName: string | null;
  domain: string;
  people: ResearchedPerson[];
  provider: 'openrouter' | 'perplexity' | 'gemini' | 'fixture';
  tier: 'T0';
  demo: boolean;
}

export interface ShareLink {
  token: string;
  map_id: string;
  created_by: string;
  expires_at: string | null;
  created_at: string;
}

export interface MapComment {
  id: string;
  person_id: string | null;
  body: string;
  created_at: string;
  author_name: string;
}
