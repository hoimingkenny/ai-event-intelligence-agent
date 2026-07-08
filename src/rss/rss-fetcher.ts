import Parser from 'rss-parser';

export interface FetchedFeedItem {
  title?: string;
  link?: string;
  guid?: string;
  content?: string;
  contentSnippet?: string;
  categories?: string[];
  isoDate?: string;
  pubDate?: string;
}

export interface RssFetcher {
  fetch(feedUrl: string): Promise<FetchedFeedItem[]>;
}

export class ParserRssFetcher implements RssFetcher {
  private readonly parser = new Parser();

  async fetch(feedUrl: string): Promise<FetchedFeedItem[]> {
    const feed = await this.parser.parseURL(feedUrl);
    return feed.items.map((item) => ({
      title: item.title,
      link: item.link,
      guid: item.guid,
      content: item.content,
      contentSnippet: item.contentSnippet,
      categories: item.categories,
      isoDate: item.isoDate,
      pubDate: item.pubDate,
    }));
  }
}
