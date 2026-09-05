import fs from "node:fs";
import path from "node:path";
import {
    CLIENT_VOCABULARY,
    CLIENT_VOCABULARY_LOCALES,
    type ClientVocabularyKey,
    type ClientVocabularyLocale,
} from "../../packages/localization/clientVocabulary";

interface LocaleDefinition {
    tag: string;
    directory: string;
    poLanguage: string;
    englishName: string;
    nativeLabelConstant: string;
}

interface NativeSettingControlDefinition {
    type: string;
    format?: string;
    headingConstant?: string;
}

interface NativeSettingDefinition {
    constant: string;
    id: string;
    type: "string" | "boolean" | "integer";
    labelConstant: string;
    helpConstant: string;
    default: string | boolean | number;
    allowEmpty?: boolean;
    maximumLength?: number;
    localeOptions?: boolean;
    minimum?: number;
    step?: number;
    maximum?: number;
    control: NativeSettingControlDefinition;
}

interface NativeSettingCategoryDefinition {
    id: string;
    labelConstant: string;
    settings: NativeSettingDefinition[];
}

interface NativeSettingsDefinition {
    sectionId: string;
    automaticLocale: {
        value: string;
        labelConstant: string;
    };
    categories: NativeSettingCategoryDefinition[];
}

interface MessageIdentity {
    constant: string;
    id: number;
}

interface LiteralMessageDefinition extends MessageIdentity {
    source: string;
    translations: Record<string, string>;
    sharedKey?: never;
}

interface SharedMessageDefinition extends MessageIdentity {
    sharedKey: ClientVocabularyKey;
    source?: never;
    translations?: never;
}

type MessageDefinition = LiteralMessageDefinition | SharedMessageDefinition;

interface ResolvedMessageDefinition extends MessageIdentity {
    source: string;
    translations: Record<string, string>;
}

interface KodiCatalogSource {
    schemaVersion: 1;
    sourceLocale: string;
    locales: LocaleDefinition[];
    nativeSettings: NativeSettingsDefinition;
    messages: MessageDefinition[];
}

interface KodiCatalog extends Omit<KodiCatalogSource, "messages"> {
    messages: ResolvedMessageDefinition[];
}

const repositoryRoot = process.cwd();
const kodiRoot = path.join(repositoryRoot, "apps", "kodi");
const catalogPath = path.join(repositoryRoot, "packages", "localization", "kodiCatalog.json");
const stringsPath = path.join(kodiRoot, "resources", "lib", "strings.py");
const nativeSettingsMetadataPath = path.join(
    kodiRoot,
    "resources",
    "lib",
    "native_settings_metadata.py",
);
const settingsPath = path.join(kodiRoot, "resources", "settings.xml");
const addonPath = path.join(kodiRoot, "addon.xml");

function assertString(value: unknown, context: string): asserts value is string {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${context} must be a non-empty string`);
    }
}

function placeholders(value: string): string[] {
    return (value.match(/%%|%(?:\d+\$)?[sdif]/g) ?? [])
        .filter((token) => token !== "%%")
        .sort((left, right) => left.localeCompare(right));
}

const clientVocabularyKeys = Object.keys(CLIENT_VOCABULARY) as ClientVocabularyKey[];
const clientVocabularyKeySet: ReadonlySet<string> = new Set(clientVocabularyKeys);
const clientVocabularyLocaleSet: ReadonlySet<string> = new Set(CLIENT_VOCABULARY_LOCALES);

function isClientVocabularyKey(value: unknown): value is ClientVocabularyKey {
    return typeof value === "string" && clientVocabularyKeySet.has(value);
}

function isClientVocabularyLocale(value: string): value is ClientVocabularyLocale {
    return clientVocabularyLocaleSet.has(value);
}

function sameValues(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
    return left.size === right.size && [...left].every((value) => right.has(value));
}

function validateCatalog(value: unknown): KodiCatalog {
    if (typeof value !== "object" || value === null) {
        throw new Error("Kodi localization catalog must be an object");
    }
    const candidate = value as Partial<KodiCatalogSource>;
    if (candidate.schemaVersion !== 1) {
        throw new Error("Kodi localization catalog schemaVersion must be 1");
    }
    assertString(candidate.sourceLocale, "sourceLocale");
    if (!Array.isArray(candidate.locales) || candidate.locales.length === 0) {
        throw new Error("Kodi localization catalog must define locales");
    }
    if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) {
        throw new Error("Kodi localization catalog must define messages");
    }
    if (typeof candidate.nativeSettings !== "object" || candidate.nativeSettings === null) {
        throw new Error("Kodi localization catalog must define nativeSettings");
    }

    const sourceLocale = candidate.sourceLocale;
    const locales = candidate.locales;
    const messages = candidate.messages;
    const localeTags = new Set<string>();
    const localeDirectories = new Set<string>();
    validateLocales();
    if (!localeTags.has(sourceLocale)) {
        throw new Error(`Source locale ${sourceLocale} is not defined`);
    }
    if (!sameValues(localeTags, clientVocabularyLocaleSet)) {
        throw new Error(
            "Kodi catalog locales must exactly match CLIENT_VOCABULARY_LOCALES so shared messages remain complete",
        );
    }
    if (!isClientVocabularyLocale(sourceLocale)) {
        throw new Error(`Source locale ${sourceLocale} is missing from CLIENT_VOCABULARY`);
    }

    const vocabularySourceLocale: ClientVocabularyLocale = sourceLocale;
    const constants = new Set<string>();
    const ids = new Set<number>();
    const consumedSharedKeys = new Set<ClientVocabularyKey>();
    const resolvedMessages: ResolvedMessageDefinition[] = [];
    let previousId = -1;
    validateMessages();
    const missingSharedKeys = clientVocabularyKeys.filter(
        (sharedKey) => !consumedSharedKeys.has(sharedKey),
    );
    if (missingSharedKeys.length > 0) {
        throw new Error(
            `Kodi catalog does not consume CLIENT_VOCABULARY keys: ${missingSharedKeys.join(", ")}`,
        );
    }

    const nativeSettings = candidate.nativeSettings;
    assertString(nativeSettings.sectionId, "nativeSettings.sectionId");
    if (
        typeof nativeSettings.automaticLocale !== "object" ||
        nativeSettings.automaticLocale === null
    ) {
        throw new Error("nativeSettings.automaticLocale must be an object");
    }
    assertString(nativeSettings.automaticLocale.value, "nativeSettings.automaticLocale.value");
    assertString(
        nativeSettings.automaticLocale.labelConstant,
        "nativeSettings.automaticLocale.labelConstant",
    );
    if (localeTags.has(nativeSettings.automaticLocale.value)) {
        throw new Error("The automatic locale value must differ from explicit locale tags");
    }
    if (!Array.isArray(nativeSettings.categories) || nativeSettings.categories.length === 0) {
        throw new Error("nativeSettings.categories must be a non-empty array");
    }

    const categoryIds = new Set<string>();
    const settingIds = new Set<string>();
    const settingConstants = new Set<string>();
    let localeSettingCount = 0;
    const referencedMessageConstants = new Set<string>([
        nativeSettings.automaticLocale.labelConstant,
        ...locales.map((locale) => locale.nativeLabelConstant),
    ]);
    validateNativeCategories();
    if (localeSettingCount !== 1) {
        throw new Error("Exactly one native setting must provide localeOptions");
    }
    validateReferencedMessages();
    return { ...candidate, messages: resolvedMessages } as KodiCatalog;

    function validateReferencedMessages() {
        for (const messageConstant of referencedMessageConstants) {
            if (!constants.has(messageConstant)) {
                throw new Error(`Native settings reference unknown message ${messageConstant}`);
            }
        }
    }

    function validateNativeCategories() {
        for (const [categoryIndex, category] of nativeSettings.categories.entries()) {
            validateNativeCategory(category, categoryIndex);
        }
    }
    function validateNativeCategory(
        category: NativeSettingCategoryDefinition,
        categoryIndex: number,
    ) {
        assertString(category.id, `nativeSettings.categories[${categoryIndex}].id`);
        assertString(
            category.labelConstant,
            `nativeSettings.categories[${categoryIndex}].labelConstant`,
        );
        if (categoryIds.has(category.id)) {
            throw new Error(`Duplicate native settings category ${category.id}`);
        }
        if (!Array.isArray(category.settings) || category.settings.length === 0) {
            throw new Error(`Native settings category ${category.id} must define settings`);
        }
        categoryIds.add(category.id);
        referencedMessageConstants.add(category.labelConstant);

        for (const [settingIndex, setting] of category.settings.entries()) {
            validateNativeSetting(settingIndex, setting);
        }

        function validateNativeSetting(settingIndex: number, setting: NativeSettingDefinition) {
            const context = `nativeSettings.categories[${categoryIndex}].settings[${settingIndex}]`;
            assertString(setting.constant, `${context}.constant`);
            assertString(setting.id, `${context}.id`);
            assertString(setting.labelConstant, `${context}.labelConstant`);
            assertString(setting.helpConstant, `${context}.helpConstant`);
            if (!/^[A-Z][A-Z0-9_]*$/.test(setting.constant)) {
                throw new Error(`Invalid native setting Python constant ${setting.constant}`);
            }
            if (!/^[a-z][a-z0-9_]*$/.test(setting.id)) {
                throw new Error(`Invalid native setting id ${setting.id}`);
            }
            if (settingConstants.has(setting.constant) || settingIds.has(setting.id)) {
                throw new Error(`Duplicate native setting ${setting.constant} (${setting.id})`);
            }
            if (!(["string", "boolean", "integer"] as const).includes(setting.type)) {
                throw new Error(`Invalid native setting type for ${setting.id}`);
            }
            if (typeof setting.control !== "object" || setting.control === null) {
                throw new Error(`${context}.control must be an object`);
            }
            assertString(setting.control.type, `${context}.control.type`);
            if (setting.control.format !== undefined) {
                assertString(setting.control.format, `${context}.control.format`);
            }
            if (setting.control.headingConstant !== undefined) {
                assertString(setting.control.headingConstant, `${context}.control.headingConstant`);
                referencedMessageConstants.add(setting.control.headingConstant);
            }
            validateSettingValue();
            validateLocaleSetting();
            settingConstants.add(setting.constant);
            settingIds.add(setting.id);
            referencedMessageConstants.add(setting.labelConstant);
            referencedMessageConstants.add(setting.helpConstant);

            function validateLocaleSetting() {
                if (setting.localeOptions === true) {
                    localeSettingCount += 1;
                    if (setting.type !== "string") {
                        throw new Error("Native locale options require a string setting");
                    }
                    if (setting.default !== nativeSettings.automaticLocale.value) {
                        throw new Error(
                            "Native locale setting must default to the automatic locale",
                        );
                    }
                } else if (setting.localeOptions !== undefined && setting.localeOptions !== false) {
                    throw new Error(`Native setting ${setting.id} localeOptions must be boolean`);
                }
            }

            function validateSettingValue() {
                if (setting.type === "string") {
                    if (typeof setting.default !== "string") {
                        throw new TypeError(
                            `Native string setting ${setting.id} must have a string default`,
                        );
                    }
                    if (
                        setting.allowEmpty !== undefined &&
                        typeof setting.allowEmpty !== "boolean"
                    ) {
                        throw new Error(`Native setting ${setting.id} allowEmpty must be boolean`);
                    }
                    if (
                        setting.maximumLength !== undefined &&
                        (!Number.isInteger(setting.maximumLength) || setting.maximumLength < 1)
                    ) {
                        throw new Error(
                            `Native setting ${setting.id} maximumLength must be positive`,
                        );
                    }
                } else if (setting.type === "boolean") {
                    if (typeof setting.default !== "boolean") {
                        throw new TypeError(
                            `Native boolean setting ${setting.id} must have a boolean default`,
                        );
                    }
                } else if (
                    !Number.isInteger(setting.default) ||
                    !Number.isInteger(setting.minimum) ||
                    !Number.isInteger(setting.step) ||
                    !Number.isInteger(setting.maximum) ||
                    (setting.minimum as number) > (setting.default as number) ||
                    (setting.default as number) > (setting.maximum as number) ||
                    (setting.step as number) < 1
                ) {
                    throw new Error(`Native integer setting ${setting.id} has invalid constraints`);
                }
            }
        }
    }

    function validateMessages() {
        for (const [index, message] of messages.entries()) {
            validateMessage(message, index);
        }
    }
    function validateMessage(message: MessageDefinition, index: number) {
        if (typeof message !== "object" || message === null) {
            throw new Error(`messages[${index}] must be an object`);
        }
        assertString(message.constant, `messages[${index}].constant`);
        if (!/^[A-Z][A-Z0-9_]*$/.test(message.constant)) {
            throw new Error(`Invalid Python constant ${message.constant}`);
        }
        if (!Number.isInteger(message.id) || message.id < 32000 || message.id > 32999) {
            throw new Error(`Invalid Kodi localization id for ${message.constant}`);
        }
        if (constants.has(message.constant)) {
            throw new Error(`Duplicate Python constant ${message.constant}`);
        }
        if (ids.has(message.id)) {
            throw new Error(`Duplicate Kodi localization id ${message.id}`);
        }
        if (message.id <= previousId) {
            throw new Error("Kodi localization messages must be sorted by id");
        }
        const translations: Record<string, string> = {};
        const source = resolveMessageText();

        for (const locale of locales) {
            if (locale.tag === sourceLocale) {
                continue;
            }
            const translation: unknown = translations[locale.tag];
            assertString(translation, `${message.constant} translation for ${locale.tag}`);
            const sourcePlaceholders = placeholders(source);
            const translatedPlaceholders = placeholders(translation);
            if (sourcePlaceholders.join("\0") !== translatedPlaceholders.join("\0")) {
                throw new Error(`Placeholder mismatch for ${message.constant} in ${locale.tag}`);
            }
        }
        constants.add(message.constant);
        ids.add(message.id);
        previousId = message.id;
        resolvedMessages.push({
            constant: message.constant,
            id: message.id,
            source,
            translations,
        });

        function resolveMessageText() {
            if (Object.hasOwn(message, "sharedKey")) {
                return resolveSharedMessage();
            } else {
                if (isClientVocabularyKey(message.constant)) {
                    throw new Error(
                        `Kodi message ${message.constant} must consume its CLIENT_VOCABULARY sharedKey`,
                    );
                }
                const literalSource: unknown = message.source;
                assertString(literalSource, `messages[${index}].source`);
                if (typeof message.translations !== "object" || message.translations === null) {
                    throw new Error(`Missing translations for ${message.constant}`);
                }
                for (const translatedLocale of Object.keys(message.translations)) {
                    if (!localeTags.has(translatedLocale) || translatedLocale === sourceLocale) {
                        throw new Error(
                            `Unexpected translation locale ${translatedLocale} for ${message.constant}`,
                        );
                    }
                    translations[translatedLocale] = message.translations[translatedLocale];
                }

                return literalSource;
            }

            function resolveSharedMessage() {
                const sharedKey: unknown = message.sharedKey;
                assertString(sharedKey, `${message.constant} sharedKey`);
                if (!isClientVocabularyKey(sharedKey)) {
                    throw new Error(`Unknown CLIENT_VOCABULARY key ${sharedKey}`);
                }
                if (message.constant !== sharedKey) {
                    throw new Error(
                        `Kodi shared message ${message.constant} must use its same-named sharedKey`,
                    );
                }
                if (Object.hasOwn(message, "source") || Object.hasOwn(message, "translations")) {
                    throw new Error(
                        `Kodi shared message ${message.constant} must not duplicate source or translations`,
                    );
                }
                if (consumedSharedKeys.has(sharedKey)) {
                    throw new Error(
                        `CLIENT_VOCABULARY key ${sharedKey} is consumed more than once`,
                    );
                }
                const vocabulary = CLIENT_VOCABULARY[sharedKey];
                const vocabularyLocales = new Set(Object.keys(vocabulary));
                if (!sameValues(vocabularyLocales, localeTags)) {
                    throw new Error(`CLIENT_VOCABULARY key ${sharedKey} has incomplete locales`);
                }
                const source = vocabulary[vocabularySourceLocale];
                assertString(source, `${sharedKey} vocabulary source for ${sourceLocale}`);
                for (const locale of locales) {
                    if (!isClientVocabularyLocale(locale.tag)) {
                        throw new Error(`Unsupported shared vocabulary locale ${locale.tag}`);
                    }
                    const text: unknown = vocabulary[locale.tag];
                    assertString(text, `${sharedKey} vocabulary value for ${locale.tag}`);
                    if (locale.tag !== sourceLocale) {
                        translations[locale.tag] = text;
                    }
                }
                consumedSharedKeys.add(sharedKey);

                return source;
            }
        }
    }

    function validateLocales() {
        for (const [index, locale] of locales.entries()) {
            assertString(locale.tag, `locales[${index}].tag`);
            assertString(locale.directory, `locales[${index}].directory`);
            assertString(locale.poLanguage, `locales[${index}].poLanguage`);
            assertString(locale.englishName, `locales[${index}].englishName`);
            assertString(locale.nativeLabelConstant, `locales[${index}].nativeLabelConstant`);
            if (localeTags.has(locale.tag)) {
                throw new Error(`Duplicate locale tag ${locale.tag}`);
            }
            if (localeDirectories.has(locale.directory)) {
                throw new Error(`Duplicate locale directory ${locale.directory}`);
            }
            localeTags.add(locale.tag);
            localeDirectories.add(locale.directory);
        }
    }
}

function readAddonMetadata(): { id: string; name: string; version: string } {
    const xml = fs.readFileSync(addonPath, "utf8");
    const addon = /<addon\b([^>]*)>/.exec(xml);
    if (addon === null) {
        throw new Error(`Unable to find <addon> in ${addonPath}`);
    }
    const readAttribute = (name: string): string => {
        const match = new RegExp(String.raw`\b${name}="([^"]+)"`).exec(addon[1]);
        if (match === null) {
            throw new Error(`Missing add-on ${name} attribute in ${addonPath}`);
        }
        return match[1];
    };
    return {
        id: readAttribute("id"),
        name: readAttribute("name"),
        version: readAttribute("version"),
    };
}

function renderStrings(catalog: KodiCatalog): string {
    const constants = catalog.messages
        .map((message) => `${message.constant} = ${message.id}`)
        .join("\n");
    const preamble = [
        '"""Stable Kodi localization identifiers used by Python presentation code."""',
        "",
        "from __future__ import annotations",
        "",
        "from dataclasses import dataclass",
        "from typing import Any, Optional",
        "",
        "",
        "@dataclass(frozen=True)",
        "class Text:",
        "    message_id: Optional[int] = None",
        "    arguments: tuple[Any, ...] = ()",
        "    literal: Optional[str] = None",
        "",
        "    @classmethod",
        '    def message(cls, message_id: int, *arguments: Any) -> "Text":',
        "        return cls(message_id=message_id, arguments=arguments)",
        "",
        "    @classmethod",
        '    def raw(cls, value: object) -> "Text":',
        "        return cls(literal=str(value))",
    ].join("\n");
    return `${preamble}\n\n\n${constants}\n`;
}

function messageId(catalog: KodiCatalog, constant: string): number {
    const message = catalog.messages.find((candidate) => candidate.constant === constant);
    if (message === undefined) {
        throw new Error(`Unknown Kodi localization constant ${constant}`);
    }
    return message.id;
}

function xml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function settingDefault(setting: NativeSettingDefinition): string {
    if (typeof setting.default === "boolean") {
        return setting.default ? "true" : "false";
    }
    return String(setting.default);
}

function renderSettingsXml(catalog: KodiCatalog): string {
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<settings version="1">',
        `    <section id="${xml(catalog.nativeSettings.sectionId)}">`,
    ];
    for (const category of catalog.nativeSettings.categories) {
        lines.push(
            `        <category id="${xml(category.id)}" label="${messageId(catalog, category.labelConstant)}">`,
            '            <group id="1">',
        );
        renderCategorySettings(category);
        lines.push("            </group>", "        </category>");
    }
    lines.push("    </section>", "</settings>");
    return `${lines.join("\n")}\n`;

    function renderCategorySettings(category: NativeSettingCategoryDefinition) {
        for (const setting of category.settings) {
            renderSetting(setting);
        }
    }
    function renderSetting(setting: NativeSettingDefinition) {
        lines.push(
            `                <setting id="${xml(setting.id)}" type="${setting.type}" label="${messageId(catalog, setting.labelConstant)}" help="${messageId(catalog, setting.helpConstant)}">`,
            "                    <level>0</level>",
        );
        const defaultValue = settingDefault(setting);
        lines.push(
            defaultValue.length === 0
                ? "                    <default />"
                : `                    <default>${xml(defaultValue)}</default>`,
        );
        const hasConstraints =
            setting.allowEmpty !== undefined ||
            setting.localeOptions === true ||
            setting.type === "integer";
        renderSettingConstraints();
        const controlAttributes = [
            `type="${xml(setting.control.type)}"`,
            ...(setting.control.format === undefined
                ? []
                : [`format="${xml(setting.control.format)}"`]),
        ].join(" ");
        if (setting.control.headingConstant === undefined) {
            lines.push(`                    <control ${controlAttributes} />`);
        } else {
            lines.push(
                `                    <control ${controlAttributes}>`,
                `                        <heading>${messageId(catalog, setting.control.headingConstant)}</heading>`,
                "                    </control>",
            );
        }
        lines.push("                </setting>");

        function renderSettingConstraints() {
            if (hasConstraints) {
                lines.push("                    <constraints>");
                if (setting.allowEmpty !== undefined) {
                    lines.push(
                        `                        <allowempty>${setting.allowEmpty ? "true" : "false"}</allowempty>`,
                    );
                }
                if (setting.localeOptions === true) {
                    lines.push("                        <options>");
                    const automaticLocale = catalog.nativeSettings.automaticLocale;
                    lines.push(
                        `                            <option label="${messageId(catalog, automaticLocale.labelConstant)}">${xml(automaticLocale.value)}</option>`,
                    );
                    for (const locale of catalog.locales) {
                        lines.push(
                            `                            <option label="${messageId(catalog, locale.nativeLabelConstant)}">${xml(locale.tag)}</option>`,
                        );
                    }
                    lines.push("                        </options>");
                }
                if (setting.type === "integer") {
                    lines.push(
                        `                        <minimum>${setting.minimum}</minimum>`,
                        `                        <step>${setting.step}</step>`,
                        `                        <maximum>${setting.maximum}</maximum>`,
                    );
                }
                lines.push("                    </constraints>");
            }
        }
    }
}

function pythonLiteral(value: string | boolean | number): string {
    if (typeof value === "boolean") return value ? "True" : "False";
    return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function renderNativeSettingsMetadata(catalog: KodiCatalog): string {
    const settings = catalog.nativeSettings.categories.flatMap((category) => category.settings);
    const lines = [
        '"""Generated Kodi native locale and settings metadata. Do not edit."""',
        "",
        ...settings.map((setting) => `${setting.constant} = ${JSON.stringify(setting.id)}`),
        "",
        "SETTING_IDS = (",
        ...settings.map((setting) => `    ${setting.constant},`),
        ")",
        "SETTING_TYPES = {",
        ...settings.map((setting) => `    ${setting.constant}: ${JSON.stringify(setting.type)},`),
        "}",
        "SETTING_LABEL_IDS = {",
        ...settings.map(
            (setting) => `    ${setting.constant}: ${messageId(catalog, setting.labelConstant)},`,
        ),
        "}",
        "SETTING_HELP_IDS = {",
        ...settings.map(
            (setting) => `    ${setting.constant}: ${messageId(catalog, setting.helpConstant)},`,
        ),
        "}",
        "SETTING_DEFAULTS = {",
        ...settings.map((setting) => `    ${setting.constant}: ${pythonLiteral(setting.default)},`),
        "}",
        "SETTING_MAXIMUM_LENGTHS = {",
        ...settings
            .filter((setting) => setting.maximumLength !== undefined)
            .map((setting) => `    ${setting.constant}: ${setting.maximumLength as number},`),
        "}",
        "SETTING_INTEGER_RANGES = {",
        ...settings
            .filter((setting) => setting.type === "integer")
            .map(
                (setting) =>
                    `    ${setting.constant}: (${setting.minimum}, ${setting.step}, ${setting.maximum}),`,
            ),
        "}",
        "",
        `SOURCE_LOCALE = ${JSON.stringify(catalog.sourceLocale)}`,
        `AUTOMATIC_LOCALE = ${JSON.stringify(catalog.nativeSettings.automaticLocale.value)}`,
        "LOCALE_VALUES = (",
        "    AUTOMATIC_LOCALE,",
        ...catalog.locales.map((locale) => `    ${JSON.stringify(locale.tag)},`),
        ")",
        "LOCALE_DIRECTORIES = {",
        ...catalog.locales.map(
            (locale) => `    ${JSON.stringify(locale.tag)}: ${JSON.stringify(locale.directory)},`,
        ),
        "}",
        "LOCALE_LABEL_IDS = {",
        `    AUTOMATIC_LOCALE: ${messageId(catalog, catalog.nativeSettings.automaticLocale.labelConstant)},`,
        ...catalog.locales.map(
            (locale) =>
                `    ${JSON.stringify(locale.tag)}: ${messageId(catalog, locale.nativeLabelConstant)},`,
        ),
        "}",
    ];
    return `${lines.join("\n")}\n`;
}

function renderPo(
    catalog: KodiCatalog,
    locale: LocaleDefinition,
    addon: { name: string; version: string },
): string {
    const header = `# ${addon.name} ${locale.englishName} localization\nmsgid ""\nmsgstr ""\n"Project-Id-Version: ${addon.name} ${addon.version}\\n"\n"Language: ${locale.poLanguage}\\n"\n"Content-Type: text/plain; charset=UTF-8\\n"\n`;
    const entries = catalog.messages.map((message) => {
        const translation =
            locale.tag === catalog.sourceLocale ? message.source : message.translations[locale.tag];
        return `msgctxt "#${message.id}"\nmsgid ${JSON.stringify(message.source)}\nmsgstr ${JSON.stringify(translation)}\n`;
    });
    return `${header}\n${entries.join("\n")}`;
}

function synchronizeFile(filePath: string, expected: string, checkOnly: boolean): boolean {
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : undefined;
    if (current === expected) {
        return false;
    }
    if (!checkOnly) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, expected, "utf8");
    }
    return true;
}

function generate(checkOnly: boolean): void {
    const catalog = validateCatalog(JSON.parse(fs.readFileSync(catalogPath, "utf8")) as unknown);
    const addon = readAddonMetadata();
    if (catalog.nativeSettings.sectionId !== addon.id) {
        throw new Error(
            `Kodi native settings section ${catalog.nativeSettings.sectionId} differs from add-on id ${addon.id}`,
        );
    }
    const outputs = new Map<string, string>();
    outputs.set(stringsPath, renderStrings(catalog));
    outputs.set(settingsPath, renderSettingsXml(catalog));
    outputs.set(nativeSettingsMetadataPath, renderNativeSettingsMetadata(catalog));
    for (const locale of catalog.locales) {
        outputs.set(
            path.join(kodiRoot, "resources", "language", locale.directory, "strings.po"),
            renderPo(catalog, locale, addon),
        );
    }

    const changed = [...outputs.entries()]
        .filter(([filePath, expected]) => synchronizeFile(filePath, expected, checkOnly))
        .map(([filePath]) => path.relative(repositoryRoot, filePath));
    if (checkOnly && changed.length > 0) {
        throw new Error(`Kodi localization artifacts are stale:\n${changed.join("\n")}`);
    }
    const action = checkOnly ? "Verified" : "Generated";
    console.log(
        `${action} ${outputs.size} Kodi localization artifacts from ${path.relative(repositoryRoot, catalogPath)}`,
    );
}

function main(): void {
    const arguments_ = new Set<string>(process.argv.slice(2));
    const checkOnly = arguments_.delete("--check");
    if (arguments_.size > 0) {
        throw new Error(`Unknown arguments: ${[...arguments_].join(", ")}`);
    }
    generate(checkOnly);
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
