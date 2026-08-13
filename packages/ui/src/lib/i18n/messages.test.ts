import { describe, expect, test } from 'bun:test';

import { dict as enDict } from './messages/en';
import { dict as zhCnDict } from './messages/zh-CN';

const localeDictionaries = {
  en: enDict,
  'zh-CN': zhCnDict,
} as const;

describe('i18n dictionaries', () => {
  test('all locales stay in key parity with english', () => {
    const englishKeys = Object.keys(enDict).sort();

    for (const dictionary of Object.values(localeDictionaries)) {
      expect(Object.keys(dictionary).sort()).toEqual(englishKeys);
    }
  });

  test('all locales expose language label keys', () => {
    for (const [, dictionary] of Object.entries(localeDictionaries)) {
      expect(dictionary['common.language.english']).toBeTruthy();
      expect(dictionary['common.language.simplifiedChinese']).toBeTruthy();
    }
  });
});
