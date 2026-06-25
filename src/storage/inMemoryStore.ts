import type { RawArticle, SecurityEvent } from '../types/domain.js';

export class InMemoryStore {
  public rawArticles = new Map<string, RawArticle>();
  public securityEvents = new Map<string, SecurityEvent>();

  saveArticle(article: RawArticle) {
    this.rawArticles.set(article.id, article);
  }

  saveEvent(event: SecurityEvent) {
    this.securityEvents.set(event.id, event);
  }

  findRecentEventsByVendor(vendors: string[], _lookbackHours: number): SecurityEvent[] {
    return Array.from(this.securityEvents.values()).filter((event) =>
      event.vendors.some((vendor) => vendors.includes(vendor))
    );
  }
}

export const store = new InMemoryStore();
