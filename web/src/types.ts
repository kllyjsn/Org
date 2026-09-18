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
  /** Latest calendar/email touch from a connected integration. */
  lastTouchAt?: string | null;
  meetingCount?: number;
  emailThreadCount?: number;
  touchSource?: 'google' | 'microsoft' | 'manual' | null;
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
  refreshCadence?: 'weekly' | 'monthly' | 'manual';
  nextRefreshAt?: string | null;
  initiatives?: StrategicInitiative[];
  strategy?: AccountStrategyPlan;
}

export type Stance = 'advocate' | 'neutral' | 'skeptic' | 'unknown';

export type StanceSignal =
  | 'support'
  | 'objection'
  | 'question'
  | 'budget'
  | 'timeline'
  | 'authority'
  | 'competitor';

export interface StanceEvidence {
  quote: string;
  signal: StanceSignal;
  transcriptId: string;
  title: string | null;
  occurredAt: string | null;
}

export interface StakeholderPlanEntry {
  stance: Stance;
  nextStep: string;
  note: string;
  evidence?: StanceEvidence[];
  stanceSource?: 'manual' | 'transcript';
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

export type ProductEventName =
  | 'map_viewed'
  | 'source_opened'
  | 'briefing_opened'
  | 'briefing_action_selected'
  | 'strategy_opened'
  | 'deep_research_completed';

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

export type IntegrationProvider = 'google' | 'microsoft';

export interface IntegrationStatus {
  id: IntegrationProvider;
  label: string;
  configured: boolean;
  connection: {
    id: string;
    accountEmail: string | null;
    status: 'connected' | 'error' | 'revoked';
    lastSyncedAt: string | null;
    lastError: string | null;
  } | null;
}

export interface IntegrationSyncResult {
  maps: number;
  touchpoints: number;
  peopleUpdated: number;
}

export type NotificationKind = 'slack_webhook' | 'email';
export type NotificationNoticeKind =
  | 'change_alert'
  | 'pre_meeting_brief'
  | 'weekly_coverage';

export interface NotificationChannel {
  id: string;
  kind: NotificationKind;
  label: string | null;
  enabled: boolean;
  createdAt: string;
  targetHint: string;
}

export interface NotificationPrefs {
  notifyEmail: boolean;
  notifyBriefs: boolean;
}

export interface NotificationRecent {
  kind: NotificationNoticeKind;
  title: string;
  scheduledFor: string;
  sentAt: string | null;
  lastError: string | null;
}

export interface NotificationsResponse {
  channels: NotificationChannel[];
  prefs: NotificationPrefs;
  emailConfigured: boolean;
  encryptionConfigured: boolean;
  recent: NotificationRecent[];
}

export interface TranscriptQuote {
  text: string;
  signal: StanceSignal;
}

export interface TranscriptSpeaker {
  speakerLabel: string;
  matchedName: string | null;
  matchedPersonId: string | null;
  inferredTitle: string | null;
  stance: Stance;
  confidence: Confidence;
  quotes: TranscriptQuote[];
  summary: string;
}

export interface TranscriptAnalysis {
  speakers: TranscriptSpeaker[];
  nextSteps: string[];
  risks: string[];
  provider: string | null;
  analyzedAt: string;
}

export interface CallTranscript {
  id: string;
  mapId: string;
  source: 'paste' | 'upload' | 'gong';
  externalId: string | null;
  title: string | null;
  occurredAt: string | null;
  analysis: TranscriptAnalysis | null;
  analysisError: string | null;
  appliedAt: string | null;
  createdAt: string;
  transcriptChars: number;
}
