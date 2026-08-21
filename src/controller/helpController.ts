/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {marked} from 'marked';
import fs from 'node:fs';
import path from 'node:path';
import {ExpectedError} from '../modules/lib/errors';

/**
 * Rewrite links to other markdown docs into /help/<doc> routes.
 *
 * Examples:
 *  - DASHBOARD.md            -> /help/dashboard
 *  - ./PACKING_LISTS.md#foo  -> /help/packing_lists#foo
 *  - /EVENTS.md              -> /help/events
 *
 * Leaves untouched:
 *  - http(s)://..., mailto:, tel:, data:
 *  - #anchors
 *  - already-correct /help/... links
 */
function rewriteDocHrefToHelpRoute(href: string): string {
    if (!href) return href;

    // Same-page anchors
    if (href.startsWith('#')) return href;

    // Already routed through help
    if (href === '/help' || href.startsWith('/help/')) return href;

    // External links and other schemes
    const lower = href.toLowerCase();
    if (
        lower.startsWith('http://') ||
        lower.startsWith('https://') ||
        lower.startsWith('mailto:') ||
        lower.startsWith('tel:') ||
        lower.startsWith('data:')
    ) {
        return href;
    }

    // Split off query/fragment and preserve it
    const qIdx = href.indexOf('?');
    const hIdx = href.indexOf('#');
    let cutIdx = Math.min(qIdx, hIdx);
    if (qIdx === -1) {
        cutIdx = hIdx;
    } else if (hIdx === -1) {
        cutIdx = qIdx;
    }

    const base = cutIdx === -1 ? href : href.slice(0, cutIdx);
    const suffix = cutIdx === -1 ? '' : href.slice(cutIdx);

    // Only rewrite *.md (case-insensitive)
    if (!base.toLowerCase().endsWith('.md')) return href;

    // Turn any path into a slug based on the filename
    // e.g. "../DASHBOARD.md" -> "dashboard"
    //      "PACKING_LISTS.md" -> "packing_lists"
    const normalized = base.replaceAll('\\', '/');
    const ext = path.posix.extname(normalized);
    const fileName = path.posix.basename(normalized, ext);
    const slug = fileName.toLowerCase();

    return `/help/${slug}${suffix}`;
}

// Configure marked for safe HTML output
marked.setOptions({
    gfm: true, // GitHub Flavored Markdown
    breaks: false,
    walkTokens(token: any) {
        // Marked v17 link tokens have shape { type: 'link', href: string, ... }
        if (token?.type === 'link' && typeof token.href === 'string') {
            token.href = rewriteDocHrefToHelpRoute(token.href);
        }
    },
});

/**
 * Get the base directory for documentation files
 * In development & prod, docs are in the project root
 */
function getDocsBasePath(): string {
    return path.join(__dirname, '..', '..', 'docs', 'user-guide');
}

/**
 * Security: Validate and resolve documentation file path
 * Prevents path traversal attacks
 */
function resolveDocPath(docName: string): string | null {
    const docsBasePath = getDocsBasePath();
    const requestedPath = path.join(docsBasePath, docName);
    const resolvedPath = path.resolve(requestedPath);
    const basePath = path.resolve(docsBasePath);

    // Ensure the resolved path is within the docs directory
    if (!resolvedPath.startsWith(basePath)) {
        return null;
    }

    // Ensure file exists and is a file (not directory)
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
        return null;
    }

    return resolvedPath;
}

/**
 * Read and parse markdown file
 */
function readMarkdownFile(filePath: string): { content: string; title: string } | null {
    try {
        const markdown = fs.readFileSync(filePath, 'utf-8');
        const html = marked.parse(markdown) as string;

        // Extract title from first H1 heading
        const titleMatch = new RegExp(/^#\s+([^\n]+)/m).exec(markdown);
        const title = titleMatch ? titleMatch[1] : 'Help';

        return {content: html, title};
    } catch (error) {
        console.error('Error reading markdown file:', error);
        return null;
    }
}

/**
 * Get list of available documentation files
 */
function getDocsList(): Array<{ name: string; title: string; path: string }> {
    const docsBasePath = getDocsBasePath();

    try {
        const files = fs.readdirSync(docsBasePath)
            .filter(file => file.endsWith('.md'))
            .sort((a, b) => a.localeCompare(b));

        return files.map(file => {
            const filePath = path.join(docsBasePath, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const titleMatch = new RegExp(/^#\s+([^\n]+)/m).exec(content);
            const title = titleMatch ? titleMatch[1] : file.replace('.md', '');
            const docPath = file.replace('.md', '').toLowerCase();

            return {name: file, title, path: docPath};
        });
    } catch (error) {
        console.error('Error listing documentation files:', error);
        return [];
    }
}

/**
 * Fetch help index data
 */
export function fetchHelpIndex(): { title: string; content: string; docsList: any[]; currentDoc: string } {
    const docsList = getDocsList();

    // Default to README if available
    const readmePath = resolveDocPath('README.md');
    let content = '';
    let title = 'Help Center';

    if (readmePath) {
        const parsed = readMarkdownFile(readmePath);
        if (parsed) {
            content = parsed.content;
            title = parsed.title;
        }
    }

    return {
        title,
        content,
        docsList,
        currentDoc: 'readme',
    };
}

/**
 * Fetch specific help document data
 */
export function fetchHelpDoc(docName: string): { title: string; content: string; docsList: any[]; currentDoc: string } {
    const docsList = getDocsList();

    // Convert URL path back to filename (e.g., 'getting_started' -> 'GETTING_STARTED.md')
    const fileName = `${docName.toUpperCase()}.md`;
    const filePath = resolveDocPath(fileName);

    if (!filePath) {
        throw new ExpectedError('Documentation not found', 'error', 404);
    }

    const parsed = readMarkdownFile(filePath);
    if (!parsed) {
        throw new ExpectedError('Error loading documentation', 'error', 500);
    }

    return {
        title: parsed.title,
        content: parsed.content,
        docsList,
        currentDoc: docName.toLowerCase(),
    };
}
