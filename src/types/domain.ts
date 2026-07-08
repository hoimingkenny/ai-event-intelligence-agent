export type CyberEventType =
  | 'active_exploitation'
  | 'cyber_attack'
  | 'ransomware'
  | 'data_breach'
  | 'zero_day'
  | 'vendor_advisory'
  | 'critical_vulnerability'
  | 'exploit_release'
  | 'patch_or_mitigation'
  | 'irrelevant';

export type DedupRelationship =
  | 'same_article_duplicate'
  | 'same_event_no_new_information'
  | 'same_event_new_source'
  | 'same_event_material_update'
  | 'related_but_separate_event'
  | 'separate_event'
  | 'uncertain_need_human_review';

export interface VendorProduct {
  id: string;
  vendor: string;
  product: string;
  aliases: string[];
  criticality: 'low' | 'medium' | 'high' | 'critical';
  inProduction: boolean;
  newsVolume: 'quiet' | 'noisy';
}

export interface RawArticle {
  id: string;
  title: string;
  url: string;
  source?: string;
  snippet?: string;
  publishedAt?: string;
  retrievedAt: string;
  query: string;
  contentHash?: string;
}

export interface ExtractedCyberFacts {
  articleId: string;
  eventType: CyberEventType;
  vendors: string[];
  products: string[];
  cveIds: string[];
  threatActors: string[];
  victimOrganizations: string[];
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  evidence: string[];
}

export interface SecurityEvent {
  id: string;
  canonicalTitle: string;
  eventType: CyberEventType;
  vendors: string[];
  products: string[];
  cveIds: string[];
  firstSeenAt: string;
  lastMaterialUpdateAt: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  recommendedActions: string[];
  articleIds: string[];
}
