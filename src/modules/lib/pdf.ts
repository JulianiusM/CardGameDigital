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

import pdfmake, {TCreatedPdf} from 'pdfmake';
import type {Content, Table, TableCell, TDocumentDefinitions, TFontDictionary} from 'pdfmake/interfaces';
import type {ParticipantRow} from "../../types/EventTypes";
import type {Event} from '../database/entities/event/Event';
import {ALLOWED_DIETARY} from "../database/entities/event/EventRegistrationDietary";

const PAGE_MARGINS: [number, number, number, number] = [28, 28, 28, 36];
const FONT_SIZE_BASE = 8;
const FONT_SIZE_SMALL = 7;
const FONT_SIZE_TITLE = 16;
const FONT_SIZE_SECTION = 11;
const FONT_SIZE_SUBSECTION = 9;
const CHIP_MAX_PER_ROW = 7;

const fonts: TFontDictionary = {
    Roboto: {
        normal: 'fonts/Roboto/Roboto-Regular.ttf',
        bold: 'fonts/Roboto/Roboto-Medium.ttf',
        italics: 'fonts/Roboto/Roboto-Italic.ttf',
        bolditalics: 'fonts/Roboto/Roboto-MediumItalic.ttf',
    }
}
pdfmake.addFonts(fonts);

function asText(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    const text = String(value).trim();
    return text.length ? text : '—';
}

export function formatDateTime(value: string | Date | null | undefined, timezone?: string | null): string {
    if (!value) return '—';
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) {
        if (typeof value === 'string') {
            return value;
        }
        return '—';
    }

    try {
        return new Intl.DateTimeFormat(undefined, {
            timeZone: timezone || 'UTC',
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(date);
    } catch {
        return date.toISOString();
    }
}

function chunk<T>(values: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
    return chunks;
}

function chip(text: string): Content {
    return {
        table: {
            widths: ['auto'],
            body: [[{
                text,
                bold: true,
                fontSize: FONT_SIZE_SMALL,
                color: '#111827',
                fillColor: '#e5e7eb',
                margin: [0, 0, 0, 0]
            }]],
        },
        layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            hLineColor: () => '#e5e7eb',
            vLineColor: () => '#e5e7eb',
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 2,
            paddingBottom: () => 2,
        },
        margin: [0, 0, 4, 4],
    } as Content;
}

function chipGrid(values: Array<string | number | null | undefined>, maxPerRow = CHIP_MAX_PER_ROW): Content {
    const items = values.map(asText).filter((value) => value !== '—');
    if (!items.length) return {text: '—', color: '#6b7280'};

    return {
        stack: chunk(items, maxPerRow).map((row) => ({
            columns: row.map((value) => ({width: 'auto', ...(chip(String(value)) as object)})),
            columnGap: 4,
            margin: [0, 0, 0, 4],
        })),
    } as Content;
}

function keyValueLine(label: string, value: string): Content {
    return {
        columns: [
            {text: `${label}:`, width: "auto", bold: true, marginRight: 4},
            {text: value, width: "*"},
        ],
        margin: [0, 0, 0, 4],
        fontSize: FONT_SIZE_BASE,
    };
}

function participantDates(participant: ParticipantRow): string {
    return `${participant.arrivalDate} -> ${participant.departureDate}`;
}

function participantDietaryChoices(participant: ParticipantRow): Array<string> {
    return (participant.dietaryChoices || [])
        .map((choice) => choice.choice)
        .filter((choice): choice is (typeof ALLOWED_DIETARY)[number] => ALLOWED_DIETARY.includes(choice as (typeof ALLOWED_DIETARY)[number]));
}

function participantAllergyText(participant: ParticipantRow): string {
    const allergyChoice = participant.dietaryChoices?.find((choice) => choice.choice === 'ALLERGIES');
    return asText(allergyChoice?.additionalInfo);
}

function participantCommentText(participant: ParticipantRow): string {
    const commentChoice = participant.dietaryChoices?.find((choice) => choice.choice === 'COMMENT');
    return asText(commentChoice?.additionalInfo);
}

function participantDietaryContent(participant: ParticipantRow): Content {
    const choices = participantDietaryChoices(participant);
    if (!choices.length) return {text: '—', color: '#6b7280'};

    return {
        stack: choices.map((choice) => chip(choice)),
        margin: [0, 0, 0, 0],
    };
}

function buildParticipantRow(participant: ParticipantRow): TableCell[] {
    const email = participant.email ?? '—';
    const allergy = participantAllergyText(participant);
    const comment = participantCommentText(participant);
    const infoStack: Content[] = [];
    if (allergy !== '—') {
        infoStack.push({text: 'Allergies:', color: '#aa0000', fontSize: FONT_SIZE_SUBSECTION},
            {text: allergy, fontSize: FONT_SIZE_BASE, marginBottom: 4});
    }
    if (comment !== '—') {
        infoStack.push({text: 'Comment:', color: '#cc9911', fontSize: FONT_SIZE_SUBSECTION},
            {text: comment, fontSize: FONT_SIZE_BASE});
    }
    if (infoStack.length === 0) {
        infoStack.push({text: '—', fontSize: FONT_SIZE_BASE});
    }

    return [
        {text: participant.name, fontSize: FONT_SIZE_BASE},
        email === '—'
            ? {text: '—', color: '#6b7280', fontSize: FONT_SIZE_BASE}
            : {text: email, link: `mailto:${email}`, fontSize: FONT_SIZE_BASE},
        {text: participantDates(participant), fontSize: FONT_SIZE_SMALL},
        participantDietaryContent(participant),
        {stack: infoStack}
    ];
}

export function buildParticipantsTable(participants: ParticipantRow[]): Table {
    const body: TableCell[][] = [
        [
            {text: 'Name', bold: true, fillColor: '#e5e7eb'},
            {text: 'Email', bold: true, fillColor: '#e5e7eb'},
            {text: 'Dates', bold: true, fillColor: '#e5e7eb'},
            {text: 'Dietary', bold: true, fillColor: '#e5e7eb'},
            {text: 'Information', bold: true, fillColor: '#e5e7eb'},
        ],
    ];

    if (!participants.length) {
        body.push([
            {text: 'No registrations yet.', colSpan: 5, italics: true, color: '#6b7280', margin: [0, 6, 0, 6]},
            {},
            {},
            {},
            {},
        ]);
    } else {
        for (const participant of participants) body.push(buildParticipantRow(participant));
    }

    return {
        headerRows: 1,
        widths: [70, 115, 45, 55, 200],
        body,
        dontBreakRows: true,
    };
}

function buildEventInfoInline(event: Event): Content {
    const fragments: Content[] = [];
    const push = (label: string, value?: string | null) => {
        if (!value) return;
        if (fragments.length) fragments.push({text: ' • ', color: '#9ca3af'});
        fragments.push({text: [{text: `${label}: `, bold: true}, {text: value}]});
    };

    if (event.location) push('Location', asText(event.location) === '—' ? null : asText(event.location));
    push('Dates', `${asText(event.startDate)} -> ${asText(event.endDate)}`);
    if (event.bindingDeadline) {
        push('Binding deadline', formatDateTime(event.bindingDeadline, event.timezone));
        push('Timezone', asText(event.timezone));
    }

    return {
        text: fragments,
        fontSize: FONT_SIZE_BASE,
        lineHeight: 1.12,
        margin: [0, 0, 0, 4],
    };
}

function buildTotalsStack(values: Record<string, number>): Content {
    const items = Object.entries(values)
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${key}: ${count}`);

    return chipGrid(items, 8);
}

export function buildParticipantsPdfDefinition(
    data: {
        event: Event;
        participants: ParticipantRow[];
        totals: Record<string, number>;
        dateTotals: Record<string, number>;
        allergies: string[];
        comments: string[];
        generatedAt: string;
    },
): TDocumentDefinitions {
    data.dateTotals['Total'] = data.participants.length;
    const content: Content[] = [
        {text: data.event.title, style: 'title', margin: [0, 0, 0, 8]},
        {text: 'Event info', style: 'sectionTitle', margin: [0, 0, 0, 4]},
        buildEventInfoInline(data.event),
        data.event.description ? keyValueLine('Description', data.event.description) : '',
        {text: 'Participants', style: 'sectionTitle', margin: [0, 8, 0, 4]},
        buildTotalsStack(data.dateTotals),
        {text: 'Dietary totals', style: 'subsectionTitle', margin: [0, 4, 0, 4]},
        buildTotalsStack(data.totals),
        {
            table: buildParticipantsTable(data.participants),
            layout: {
                hLineWidth: (i: number, node: {
                    table?: { body?: unknown[] }
                }) => (i === 0 || i === 1 || i === (node.table?.body?.length || 0) ? 1 : 0.5),
                vLineWidth: () => 0.5,
                hLineColor: () => '#d1d5db',
                vLineColor: () => '#d1d5db',
                paddingLeft: () => 6,
                paddingRight: () => 6,
                paddingTop: () => 4,
                paddingBottom: () => 4,
            },
            margin: [0, 0, 0, 8],
        },
    ];

    return {
        pageSize: 'A4',
        pageOrientation: 'portrait',
        pageMargins: PAGE_MARGINS,
        content,
        defaultStyle: {fontSize: FONT_SIZE_BASE},
        styles: {
            title: {fontSize: FONT_SIZE_TITLE, bold: true},
            sectionTitle: {fontSize: FONT_SIZE_SECTION, bold: true},
            subsectionTitle: {fontSize: FONT_SIZE_SUBSECTION, bold: true},
        },
        footer: (currentPage, pageCount) => ({
            columns: [
                {
                    text: `Generated: ${formatDateTime(data.generatedAt)} UTC`,
                    fontSize: FONT_SIZE_SMALL,
                    color: '#6b7280'
                },
                {
                    text: `Page ${currentPage} / ${pageCount}`,
                    alignment: 'right',
                    fontSize: FONT_SIZE_SMALL,
                    color: '#6b7280'
                },
            ],
            margin: [28, 0, 28, 16],
        }),
    };
}

export function createParticipantsPdf(
    data: {
        event: Event;
        participants: ParticipantRow[];
        totals: Record<string, number>;
        dateTotals: Record<string, number>;
        allergies: string[];
        comments: string[];
        generatedAt: string;
    },
): TCreatedPdf {
    return pdfmake.createPdf(buildParticipantsPdfDefinition(data));
}
