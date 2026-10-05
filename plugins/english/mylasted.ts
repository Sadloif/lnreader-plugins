import { Plugin } from '@/types/plugin';
import { fetchApi } from '@libs/fetch';
import { defaultCover } from '@libs/defaultCover';
import { load } from 'cheerio';

type Entry = {
  title: { $t: string };
  link: { rel: string; href: string }[];
  published: { $t: string };
  content?: { $t: string };
};
type Feed = { openSearch$totalResults: { $t: string }; entry?: Entry[] };

class MachineEditing implements Plugin.PluginBase {
  id = 'mylasted';
  name = 'Machine Editing (MyLasted)';
  site = 'https://mylasted.blogspot.com';
  icon = 'src/en/mylasted/icon.png';
  version = '1.0.0';

  private async request(url: string) {
    const response = await fetchApi(url);
    if (!response.ok)
      throw Object.assign(
        new Error(`Machine Editing: HTTP ${response.status}.`),
        {
          status: response.status,
        },
      );
    return response;
  }

  private async feed(label: string, start = 1, summary = false): Promise<Feed> {
    const url = `${this.site}/feeds/posts/${summary ? 'summary' : 'default'}/-/${encodeURIComponent(label)}?alt=json&max-results=150&start-index=${start}`;
    const data = await (await this.request(url)).json();
    const feed: Feed = data.feed;
    if (!feed || !Number.isInteger(Number(feed.openSearch$totalResults?.$t)))
      throw new Error('Machine Editing: the public feed could not be read.');
    return feed;
  }

  private project(entry: Entry): Plugin.NovelItem {
    const href = entry.link.find(link => link.rel === 'alternate')?.href;
    if (!href) throw new Error('Machine Editing: a series address is missing.');
    const $ = load(entry.content?.$t || '');
    return {
      name: entry.title.$t,
      path: new URL(this.resolveUrl(href)).pathname,
      cover: $('img').first().attr('src') || defaultCover,
    };
  }

  async popularNovels(page: number): Promise<Plugin.NovelItem[]> {
    if (page !== 1) return [];
    const feed = await this.feed('Series');
    const entries = feed.entry || [];
    if (entries.length !== Number(feed.openSearch$totalResults.$t))
      throw new Error('Machine Editing: the series list is incomplete.');
    return entries.map(entry => this.project(entry));
  }

  async parseNovel(path: string): Promise<Plugin.SourceNovel> {
    const $ = load(await (await this.request(this.resolveUrl(path))).text());
    const label = /clwd\.run\(\s*['"]([^'"]+)['"]\s*\)/.exec(
      $('#clwd').html() || '',
    )?.[1];
    if (!label)
      throw new Error(
        'Machine Editing: the novel chapter label could not be read.',
      );
    const first = await this.feed(label, 1, true);
    const total = Number(first.openSearch$totalResults.$t);
    if (total < 1 || total > 15000)
      throw new Error('Machine Editing: invalid chapter count.');
    let start = 1;
    const chapters: Plugin.ChapterItem[] = [];
    const seen: Record<string, boolean> = {};
    while (start <= total) {
      const feed = start === 1 ? first : await this.feed(label, start, true);
      const entries = feed.entry || [];
      if (Number(feed.openSearch$totalResults.$t) !== total || !entries.length)
        throw new Error(
          'Machine Editing: the chapter feed changed. Refresh to retry.',
        );
      for (const entry of entries) {
        const href = entry.link.find(link => link.rel === 'alternate')?.href;
        if (!href)
          throw new Error('Machine Editing: a chapter address is missing.');
        const chapterPath = new URL(this.resolveUrl(href)).pathname;
        if (seen[chapterPath])
          throw new Error('Machine Editing: repeated feed page.');
        seen[chapterPath] = true;
        const number = /(?:chapter|episode)\s+(\d+(?:\.\d+)?)/i.exec(
          entry.title.$t,
        );
        if (!number && !/prologue|epilogue|side story/i.test(entry.title.$t))
          continue;
        chapters.push({
          name: entry.title.$t,
          path: chapterPath,
          chapterNumber: number ? Number(number[1]) : undefined,
          releaseTime: entry.published.$t,
        });
      }
      start += entries.length;
    }
    if (!chapters.length)
      throw new Error('Machine Editing: no chapter entries were found.');
    chapters.sort((a, b) => {
      if (a.chapterNumber !== undefined && b.chapterNumber !== undefined)
        return a.chapterNumber - b.chapterNumber;
      return (a.releaseTime || '').localeCompare(b.releaseTime || '');
    });
    const field = (label: string) =>
      $('#extra-info dt')
        .filter((_, element) => $(element).text().trim() === label)
        .first()
        .next('dd')
        .text()
        .trim() || undefined;
    const name =
      $('meta[property="og:title"]').attr('content') ||
      $('h1').first().text().trim();
    return {
      name,
      path,
      cover: $('article img').first().attr('src') || defaultCover,
      summary: $('#synopsis').text().trim(),
      author: field('Author'),
      genres: field('Tags'),
      status: field('Chapter'),
      chapters,
    };
  }

  async parseChapter(path: string): Promise<string> {
    const $ = load(await (await this.request(this.resolveUrl(path))).text());
    const body = $('article.txt').first();
    if ($('#clwd', body).length)
      throw new Error('Machine Editing: this is a series page, not a chapter.');
    body.find('script,style,iframe,form,.adsbygoogle,.separator').remove();
    body.find('[style]').removeAttr('style');
    body.find('div,p').each((_, element) => {
      if (
        /^Consider supporting me by subscribing/i.test($(element).text().trim())
      )
        $(element).remove();
    });
    if (body.text().trim().length < 200)
      throw new Error('Machine Editing: no readable public chapter was found.');
    return body.html()!;
  }

  async searchNovels(term: string, page: number): Promise<Plugin.NovelItem[]> {
    const query = term.trim().toLowerCase();
    return (await this.popularNovels(page)).filter(novel =>
      novel.name.toLowerCase().includes(query),
    );
  }

  resolveUrl(path: string): string {
    const url = new URL(path, this.site);
    if (url.origin !== this.site)
      throw new Error('Machine Editing: invalid page address.');
    return url.href;
  }
}

export default new MachineEditing();
