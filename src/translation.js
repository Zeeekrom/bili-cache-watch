import * as OpenCC from 'opencc-js';
import { updateVideoTitleTranslations } from './db.js';

const supportedLanguages = new Set(['zh-Hans', 'zh-Hant', 'en-AU']);
const toTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' });

const libreTranslateUrl = process.env.LIBRETRANSLATE_URL || process.env.TRANSLATE_API_URL || '';
const libreTranslateKey = process.env.LIBRETRANSLATE_API_KEY || process.env.TRANSLATE_API_KEY || '';

export function normaliseLanguage(value) {
  return supportedLanguages.has(value) ? value : 'zh-Hans';
}

export async function translateVideoTitles(videos, language) {
  const targetLanguage = normaliseLanguage(language);

  if (targetLanguage === 'zh-Hans') {
    return videos.map((video) => ({
      ...video,
      display_title: video.title || video.bvid,
      display_language: 'zh-Hans'
    }));
  }

  const translated = [];
  for (const video of videos) {
    translated.push(await translateVideoTitle(video, targetLanguage));
  }
  return translated;
}

export async function translateVideoTitle(video, language) {
  const sourceTitle = video.title || video.bvid;
  const cached = language === 'zh-Hant'
    ? video.title_zh_hant
    : video.title_en_au;

  if (cached && video.title_translation_source === sourceTitle) {
    return withDisplayTitle(video, cached, language);
  }

  const translations = {};
  if (language === 'zh-Hant') {
    translations['zh-Hant'] = toTraditional(sourceTitle);
  }

  if (language === 'en-AU') {
    translations['en-AU'] = await translateTitlePreservingOwner(sourceTitle);
  }

  updateVideoTitleTranslations(video.id, sourceTitle, translations);
  return withDisplayTitle(video, translations[language] || sourceTitle, language, {
    pending: language === 'en-AU' && !translations[language]
  });
}

async function translateToAustralianEnglish(text) {
  if (!libreTranslateUrl) {
    return null;
  }

  try {
    const response = await fetch(new URL('/translate', libreTranslateUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: 'zh',
        target: 'en',
        format: 'text',
        ...(libreTranslateKey ? { api_key: libreTranslateKey } : {})
      })
    });

    if (!response.ok) {
      console.warn(`[translation] LibreTranslate failed: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    return normaliseAustralianEnglish(data.translatedText || data.translation || '');
  } catch (error) {
    console.warn(`[translation] ${error.message}`);
    return null;
  }
}

async function translateTitlePreservingOwner(title) {
  const { mainTitle, ownerSuffix } = splitOwnerSuffix(title);
  const translatedTitle = await translateToAustralianEnglish(mainTitle);
  return translatedTitle ? `${translatedTitle}${ownerSuffix}` : null;
}

function splitOwnerSuffix(title) {
  const match = String(title || '').match(/^(.*?)(\s+-\s+[\w .@-]+)$/);
  if (!match) {
    return { mainTitle: title, ownerSuffix: '' };
  }
  return { mainTitle: match[1], ownerSuffix: match[2] };
}

function normaliseAustralianEnglish(text) {
  return String(text || '')
    .replace(/\bairplane\b/gi, matchCase('aeroplane'))
    .replace(/\bairplanes\b/gi, matchCase('aeroplanes'))
    .replace(/\bbehavior\b/gi, matchCase('behaviour'))
    .replace(/\bcenter\b/gi, matchCase('centre'))
    .replace(/\bcolor\b/gi, matchCase('colour'))
    .replace(/\bgray\b/gi, matchCase('grey'))
    .replace(/\btraveled\b/gi, matchCase('travelled'))
    .replace(/\btraveling\b/gi, matchCase('travelling'));
}

function matchCase(replacement) {
  return (word) => {
    if (word === word.toUpperCase()) {
      return replacement.toUpperCase();
    }
    if (word[0] === word[0].toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
  };
}

function withDisplayTitle(video, displayTitle, language, options = {}) {
  return {
    ...video,
    display_title: displayTitle || video.title || video.bvid,
    display_language: language,
    display_title_pending_translation: Boolean(options.pending)
  };
}
