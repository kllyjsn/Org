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
  team?: string | null;
  productLine?: string | null;
  teamEvidence?: 'sourced' | 'inferred' | null;
  role: BuyingRole;
  confidence: Confidence;
  sources: string[];
  conflictingTitles?: string[];
  researchStatus?: 'verified' | 'possibly_stale' | 'conflicting';
  notes: string;
  email: string | null;
  linkedin: string | null;
  x: number;
  y: number;
  width?: number;
  height?: number;
  groupId?: string;
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  kind: 'reports' | 'influence';
  label: string | null;
  inferred?: boolean;
}

export interface MapMeta {
  domain: string;
  companyName: string | null;
  researchedAt: string | null;
  tier: string;
  provider: string | null;
  initiatives?: StrategicInitiative[];
}

export interface StrategicInitiative {
  name: string;
  summary: string;
  category: 'product' | 'growth' | 'operations' | 'technology' | 'market';
  evidence: string[];
  relevantPeople: string[];
  relevantTeams: string[];
  salesAngles: string[];
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
  plan: 'free' | 'pro';
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
  team: string | null;
  productLine: string | null;
  teamEvidence: 'sourced' | 'inferred' | null;
  reportsToName: string | null;
  confidence: Confidence;
  source: string | null;
  sources: string[];
  conflictingTitles: string[];
  researchStatus: 'verified' | 'possibly_stale' | 'conflicting';
}

export interface ResearchResult {
  companyName: string | null;
  domain: string;
  people: ResearchedPerson[];
  provider: 'openrouter' | 'perplexity' | 'gemini' | 'fixture';
  tier: 'T0';
  demo: boolean;
  initiatives: StrategicInitiative[];
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

export interface MapVersion {
  id: string;
  name: string;
  author_name: string;
  created_at: string;
}

export interface MapChangeAlert {
  id: string;
  type:
    | 'person_added'
    | 'person_removed'
    | 'title_changed'
    | 'team_changed'
    | 'role_changed'
    | 'initiative_added'
    | 'initiative_removed';
  title: string;
  detail: string;
  personId?: string;
  sources?: string[];
}

export interface MapPresence {
  id: string;
  name: string;
  email: string;
  last_seen: string;
  cursor_x: number | null;
  cursor_y: number | null;
  selected_person_id: string | null;
}
