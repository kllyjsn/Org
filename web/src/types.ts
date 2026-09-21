import type { Fn, Seniority } from './lib/taxonomy';

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
  /** Structured seniority from enrichment (CXO/VP/Director/…) when known. */
  jobLevel?: string | null;
  notes: string;
  /** Marked when the user has met this person (meeting import / panel). */
  metWith?: boolean;
  email: string | null;
  linkedin: string | null;
  x: number;
  y: number;
  width?: number;
  height?: number;
  groupId?: string;
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

export type EvidenceKind =
  | 'sumble_relationship'
  | 'research_reportsTo'
  | 'title_inference'
  | 'llm';

export interface SuggestedGroup {
  id: string;
  name: string;
  parentGroupId: string | null;
  function: Fn | null;
  confidence: Confidence;
}

export interface SuggestedPerson {
  rosterId: string;
  name: string;
  title: string;
  function: Fn;
  seniority: Seniority;
  groupId: string;
  reportsToRosterId: string | null;
  reportsToPersonId: string | null;
  confidence: Confidence;
  evidence: {
    kind: EvidenceKind;
    sourceUrl?: string;
    note?: string;
  };
}

export interface ChartSuggestion {
  groups: SuggestedGroup[];
  people: SuggestedPerson[];
  stats: {
    candidates: number;
    suggested: number;
    withEvidenceEdges: number;
  };
}

export interface SuggestChartRequest {
  functions?: Fn[];
  minSeniority?: Seniority;
  limit?: number;
  personasOnly?: boolean;
  guidance?: string;
  excludeRosterIds?: string[];
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isAdmin?: boolean;
}

export type FeedbackCategory = 'bug' | 'idea' | 'research_quality' | 'other';
export type FeedbackStatus = 'new' | 'reviewing' | 'resolved';

export interface FeedbackItem {
  id: string;
  category: FeedbackCategory;
  message: string;
  page_path: string | null;
  status: FeedbackStatus;
  created_at: string;
  author_name: string;
  author_email: string;
  workspace_name: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  role: 'owner' | 'member' | 'viewer';
  plan: 'free' | 'pro';
  seller_profile: SellerProfile | null;
}

export type PersonaBuyingRole =
  | 'economic_buyer'
  | 'champion'
  | 'decision_maker'
  | 'technical_buyer'
  | 'influencer'
  | 'blocker';

/** Workspace-level targeting persona (function set + seniority floor). */
export interface Persona {
  id: string;
  name: string;
  /** Canonical `Fn` values; empty means any function. */
  functions: Fn[];
  /** Inclusive floor: 'vp' means VP and above. */
  minSeniority: Seniority;
  titleKeywords: string[];
  buyingRole: PersonaBuyingRole | null;
  required: boolean;
  sortOrder: number;
}

export type PersonaInput = Omit<Persona, 'id' | 'sortOrder'> & { id?: string };

export interface PersonaCoverage {
  personaId: string;
  name: string;
  required: boolean;
  matches: { personId: string; name: string; title: string }[];
  covered: boolean;
}

export interface MapCoverage {
  personas: PersonaCoverage[];
  coveredCount: number;
  requiredCount: number;
  totalCovered: number;
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

export interface MapListItem {
  id: string;
  name: string;
  domain: string;
  company_name: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  is_live_opportunity: boolean;
  peopleCount: number;
  initiativeCount: number;
}

export interface LoadedMap {
  id: string;
  workspace_id: string;
  name: string;
  domain: string;
  company_name: string | null;
  state: MapState;
  is_live_opportunity: boolean;
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
  sourceDetails: ResearchSource[];
  freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
  corroborationCount: number;
  lastVerifiedAt: string | null;
  conflictingTitles: string[];
  researchStatus: 'verified' | 'possibly_stale' | 'conflicting';
  linkedin?: string | null;
  jobLevel?: string | null;
}

export interface ResearchResult {
  companyName: string | null;
  companyProfile: CompanyProfile | null;
  domain: string;
  people: ResearchedPerson[];
  provider: 'openrouter' | 'perplexity' | 'gemini' | 'fixture';
  tier: 'T0';
  demo: boolean;
  initiatives: StrategicInitiative[];
  /** Stored map source URLs the server verified as dead (404/410). */
  deadSources?: string[];
  complete: boolean;
}

export type ResearchStep =
  | 'discover'
  | 'sumble'
  | 'passes'
  | 'initiatives'
  | 'followup'
  | 'dead_sources'
  | 'verify'
  | 'done';

export interface ResearchEvent {
  at: string;
  step: ResearchStep;
  level: 'info' | 'warn';
  message: string;
  peopleCount?: number;
}

export interface ResearchJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  step: ResearchStep;
  domain: string;
  focus: string | null;
  events: ResearchEvent[];
  partial: ResearchResult | null;
  result: ResearchResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
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

export interface BriefingAction {
  id: string;
  title: string;
  reason: string;
  confidence: Confidence;
  provenance: 'sourced' | 'map' | 'hypothesis';
  type:
    | 'focus_people'
    | 'open_strategy'
    | 'open_initiatives'
    | 'deep_research';
  personIds?: string[];
  focus?: string;
  evidence: string[];
}

export interface AccountBriefing {
  generatedAt: string;
  baselineAt: string | null;
  headline: string;
  summary: string;
  changes: MapChangeAlert[];
  actions: BriefingAction[];
  valueCase: AccountValueCase | null;
}

export interface BriefingInsight {
  statement: string;
  provenance: 'sourced' | 'hypothesis';
  evidence: string[];
}

export interface StakeholderMessage extends BriefingInsight {
  personId?: string;
  personName: string;
  relevance: string;
}

export interface AccountValueCase {
  methodology: 'Command of the Message';
  researchDepth: 'live' | 'map_only';
  currentState: BriefingInsight[];
  businessProblems: BriefingInsight[];
  businessImpact: BriefingInsight[];
  desiredOutcomes: BriefingInsight[];
  requiredCapabilities: BriefingInsight[];
  decisionCriteria: BriefingInsight[];
  differentiation: BriefingInsight[];
  stakeholderMessages: StakeholderMessage[];
  discoveryQuestions: string[];
  researchGaps: string[];
}

export interface StrategyInsights {
  generatedAt: string;
  provider: string;
  researchDepth: 'live' | 'map_only';
  executiveSummary: string;
  winThemes: BriefingInsight[];
  landingPlays: {
    title: string;
    rationale: string;
    personIds: string[];
    provenance: 'sourced' | 'hypothesis';
    evidence: string[];
  }[];
  stakeholderQuestions: {
    personId?: string;
    personName: string;
    questions: string[];
  }[];
  competitiveWatch: BriefingInsight[];
  mutualActionPlan: {
    milestone: string;
    owner: 'seller' | 'buyer' | 'joint';
    timing: string;
  }[];
  researchGaps: string[];
}

export interface AccountAgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AccountAgentCitation {
  id: string;
  label: string;
  url?: string;
  personId?: string;
}

export interface AccountAgentAction {
  type: 'focus_people' | 'open_strategy' | 'open_initiatives' | 'deep_research';
  label: string;
  personIds?: string[];
  focus?: string;
}

export interface AccountAgentAnswer {
  answer: string;
  citations: AccountAgentCitation[];
  actions: AccountAgentAction[];
  provider: string;
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

export interface OutreachDraft {
  generatedAt: string;
  provider: string;
  subject: string;
  emailBody: string;
  linkedinNote: string;
  talkingPoints: string[];
  evidence: string[];
}

export interface WatchedPerson {
  id: string;
  workspace_id: string;
  map_id: string;
  person_id: string;
  person_key: string;
  name: string;
  title: string | null;
  role: string | null;
  company_name: string | null;
  domain: string;
  linkedin: string | null;
  status: 'watching' | 'moved' | 'departed';
  next_check_at: string;
  last_checked_at: string | null;
  created_by: string;
  created_at: string;
}

export interface PersonSignal {
  id: string;
  workspace_id: string;
  watch_id: string;
  map_id: string;
  map_name: string;
  person_name: string;
  kind: 'moved' | 'departed';
  title: string;
  detail: string | null;
  new_company: string | null;
  new_title: string | null;
  new_domain: string | null;
  sources: string[];
  created_at: string;
  dismissed_at: string | null;
}

export type ProductEventName =
  | 'map_viewed'
  | 'source_opened'
  | 'briefing_opened'
  | 'briefing_action_selected'
  | 'strategy_opened'
  | 'deep_research_completed'
  | 'outreach_drafted'
  | 'person_watch_set';

export interface ProductValueSummary {
  personal: {
    mapsCreated: number;
    usefulMaps: number;
    sourceOpens: number;
    briefingOpens: number;
    actionsTaken: number;
    refinements: number;
    repeatAccounts: number;
    collaborationActions: number;
    liveOpportunityMaps: number;
    estimatedMinutesSaved: number;
    firstUsefulMapMinutes: number | null;
  };
  workspace: {
    activeUsers: number;
    contributors: number;
    mapsCreated: number;
    usefulMaps: number;
    briefingOpens: number;
    actionsTaken: number;
    collaborationActions: number;
    liveOpportunityMaps: number;
    briefingActionRate: number;
  };
  platform?: {
    registeredUsers: number;
    activatedUsers: number;
    activeUsers30d: number;
    retainedUsers30d: number;
    mapsCreated: number;
    liveOpportunityMaps: number;
    briefingActionRate: number;
  };
}
