import { Plugin } from '@/types/plugin';
import { fetchApi } from '@libs/fetch';
import { defaultCover } from '@libs/defaultCover';
import { load } from 'cheerio';

class HenNovelTranslations implements Plugin.PluginBase {
  id = 'hennoveltranslations';
  name = 'Hen Novel Translations';
  site = 'https://hennoveltranslations.org';
  icon = 'src/en/hennoveltranslations/icon.png';
  version = '1.0.0';

  private async document(path: string) {
    const response = await fetchApi(this.resolveUrl(path));
    if (!response.ok)
      throw Object.assign(
        new Error(`Hen Novel Translations: HTTP ${response.status}.`),
        {
          status: response.status,
        },
      );
    return load(await response.text());
  }

  async popularNovels(page: number): Promise<Plugin.NovelItem[]> {
    if (page !== 1) return [];
    const $ = await this.document('/');
    const novels: Plugin.NovelItem[] = [];
    $('.book-item-feature').each((_, element) => {
      const card = $(element);
      const title = card.find('.book-title a');
      const href = title.attr('href');
      if (!href || !title.text().trim()) return;
      const image = card.find('img').first();
      novels.push({
        name: title.text().trim(),
        path: new URL(this.resolveUrl(href)).pathname,
        cover: image.attr('data-src') || image.attr('src') || defaultCover,
      });
    });
    if (!novels.length)
      throw new Error(
        'Hen Novel Translations: the project list could not be read.',
      );
    return novels;
  }

  async parseNovel(path: string): Promise<Plugin.SourceNovel> {
    const $ = await this.document(path);
    const name = $('.single-novel-title h1').text().trim();
    if (!name)
      throw new Error('Hen Novel Translations: the novel could not be read.');
    const details = $('.custom-fields').first();
    const field = (label: string) => {
      const paragraph = details
        .find('p')
        .filter(
          (_, element) =>
            $(element).find('strong').first().text().trim() === label,
        )
        .first()
        .clone();
      paragraph.find('strong').remove();
      return paragraph.text().trim() || undefined;
    };
    const summary = details.clone();
    summary.find('h2,.alternate-chapters,p').remove();
    const chapters: Plugin.ChapterItem[] = [];
    const seen: Record<string, boolean> = {};
    // The site's episode-list2 is its FREE CHAPTERS list; list1 is paid advance access.
    $('.episode-list2 a[href]').each((_, element) => {
      const link = $(element);
      const url = new URL(this.resolveUrl(link.attr('href')!));
      if (!url.pathname.startsWith('/episodes/') || seen[url.pathname]) return;
      seen[url.pathname] = true;
      const title = link.text().trim();
      const number = /(?:episode|chapter)\s+(\d+(?:\.\d+)?)/i.exec(title);
      const row = link.closest('li');
      chapters.push({
        name: title,
        path: url.pathname,
        chapterNumber: number ? Number(number[1]) : undefined,
        releaseTime: row.find('time').attr('datetime'),
      });
    });
    chapters.reverse();
    if (!chapters.length)
      throw new Error(
        'Hen Novel Translations: no free chapter list was found.',
      );
    return {
      name,
      path,
      cover: $('.novel-content img').first().attr('src') || defaultCover,
      summary: summary.text().trim(),
      author: field('Author:'),
      genres: field('Genre:'),
      status: field('Light Novel Status(Korean):'),
      chapters,
    };
  }

  async parseChapter(path: string): Promise<string> {
    const $ = await this.document(path);
    const body = $('.episode-content').first();
    if (
      body.find('input[type=password]').length ||
      /^(?:This content is|Please log in|You must be logged)/i.test(
        body.text().trim(),
      )
    )
      throw new Error(
        'Hen Novel Translations: this chapter is not publicly readable.',
      );
    body
      .find('script,style,iframe,form,button,.episode-navigation,.adsbygoogle')
      .remove();
    body.find('[style]').removeAttr('style');
    if (body.text().trim().length < 200)
      throw new Error(
        'Hen Novel Translations: no readable public chapter was found.',
      );
    return body.html()!;
  }

  async searchNovels(term: string, page: number): Promise<Plugin.NovelItem[]> {
    const query = term.trim().toLowerCase();
    return (await this.popularNovels(page)).filter(novel =>
      (novel.name + ' ' + novel.path.replace(/-/g, ' '))
        .toLowerCase()
        .includes(query),
    );
  }

  resolveUrl(path: string): string {
    const url = new URL(path, this.site);
    if (url.origin !== this.site)
      throw new Error('Hen Novel Translations: invalid page address.');
    return url.href;
  }
}

export default new HenNovelTranslations();
