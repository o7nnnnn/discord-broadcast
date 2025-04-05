const { createLogger } = require('../utils/helpers');
const path = require('path');
const fs = require('fs');

const logger = createLogger('LanguageManager');

class LanguageManager {
    constructor() {
        this.defaultLanguage = 'en';
        this.languages = {};
        this.loadAllLanguages();
    }

    loadAllLanguages() {
        try {
            const localesDir = path.join(__dirname, '..', 'locales');
            const files = fs.readdirSync(localesDir);
            
            files.forEach(file => {
                if (file.endsWith('.json')) {
                    const languageCode = file.replace('.json', '');
                    const filePath = path.join(localesDir, file);
                    const languageData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    
                    this.languages[languageCode] = languageData;
                    logger.info(`Loaded language: ${languageCode} (${languageData.language.native})`);
                }
            });
            
            logger.info(`Loaded ${Object.keys(this.languages).length} languages`);
            
            if (!this.languages.en) {
                logger.error('English language file not found! Some functionality may not work correctly.');
            }
        } catch (error) {
            logger.error(`Failed to load language files: ${error.message}`);
            
            this.loadDefaultLanguages();
        }
    }
    

    loadDefaultLanguages() {
        logger.info('Loading embedded default languages');
        
        try {
            const enDefault = require('../locales/en.json');
            const arDefault = require('../locales/ar.json');
            
            this.languages.en = enDefault;
            this.languages.ar = arDefault;
            
            logger.info('Loaded default languages from embedded defaults');
        } catch (error) {
            logger.error(`Failed to load embedded defaults: ${error.message}`);
            logger.info('Creating minimal language definitions');
            
            this.languages = {
                en: {
                    language: { name: "English", native: "English", code: "en" },
                    messages: { error: "Error loading language files" }
                },
                ar: {
                    language: { name: "Arabic", native: "العربية", code: "ar" },
                    messages: { error: "خطأ في تحميل ملفات اللغة" }
                }
            };
        }
    }

    setDefaultLanguage(langCode) {
        if (this.languages[langCode]) {
            this.defaultLanguage = langCode;
            logger.info(`Default language set to: ${langCode}`);
        } else {
            logger.warn(`Attempted to set invalid language: ${langCode}, defaulting to 'en'`);
            this.defaultLanguage = 'en';
        }
    }

    getLanguage(langCode) {
        const lang = langCode || this.defaultLanguage;
        return this.languages[lang] || this.languages.en;
    }

    getAllLanguages() {
        return this.languages;
    }

    getDefaultLanguageCode() {
        return this.defaultLanguage;
    }
    
    formatMessage(message, ...args) {
        if (!message) return '';
        
        let result = message;
        args.forEach((arg, i) => {
            result = result.replace(new RegExp(`\\{${i}\\}`, 'g'), arg);
        });
        
        return result;
    }
    
    translate(key, ...args) {
        const lang = this.getLanguage();
        const keys = key.split('.');
        
        let value = lang;
        for (const k of keys) {
            if (!value || !value[k]) {
                if (lang !== this.languages.en) {
                    const enValue = this.getValueFromPath(this.languages.en, keys);
                    if (enValue) {
                        return this.formatMessage(enValue, ...args);
                    }
                }
                return key;
            }
            value = value[k];
        }
        
        return this.formatMessage(value, ...args);
    }
    
    getValueFromPath(obj, path) {
        let value = obj;
        for (const key of path) {
            if (!value || !value[key]) return undefined;
            value = value[key];
        }
        return value;
    }
}

module.exports = new LanguageManager();