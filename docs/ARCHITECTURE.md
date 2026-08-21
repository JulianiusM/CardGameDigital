# Surveyor Architecture

This document describes the overall architecture, design patterns, and technical decisions in the Surveyor application.

## Table of Contents

- [System Overview](#system-overview)
- [Technology Stack](#technology-stack)
- [Application Layers](#application-layers)
- [Database Design](#database-design)
- [Frontend Architecture](#frontend-architecture)
- [Authentication & Authorization](#authentication--authorization)
- [Testing Architecture](#testing-architecture)
- [Design Patterns](#design-patterns)

---

## System Overview

Surveyor is a **monolithic web application** for survey and event management with the following characteristics:

- **Backend**: Node.js + Express.js + TypeScript
- **Database**: MariaDB with TypeORM
- **Frontend**: Server-rendered Pug templates + vanilla JavaScript/TypeScript
- **Authentication**: OIDC (OpenID Connect)
- **Testing**: Playwright Test

### High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Client Browser                     │
│  ┌────────────┐  ┌─────────────┐  ┌──────────────┐ │
│  │ Pug Views  │  │ Client JS   │  │ Bootstrap UI │ │
│  └────────────┘  └─────────────┘  └──────────────┘ │
└────────────────────┬────────────────────────────────┘
                     │ HTTP/HTTPS
┌────────────────────┴────────────────────────────────┐
│              Express.js Application                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  Routes     │→ │ Controllers  │→ │ Services   │ │
│  └─────────────┘  └──────────────┘  └────────────┘ │
│  ┌─────────────┐  ┌──────────────┐                 │
│  │ Middleware  │  │ Permissions  │                 │
│  └─────────────┘  └──────────────┘                 │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────┐
│              MariaDB Database (TypeORM)              │
│  ┌───────────────────────────────────────────────┐ │
│  │  Entities: Users, Surveys, Events, Activities │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | ≥ 24.x | Runtime environment |
| TypeScript | Latest | Type-safe JavaScript |
| Express.js | 4.x | Web framework |
| TypeORM | Latest | ORM for database access |
| Pug | 3.x | Template engine |
| bcryptjs | Latest | Password hashing |
| express-session | Latest | Session management |
| express-validator | Latest | Input validation |

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| TypeScript | Latest | Type-safe client code |
| Bootstrap | 5.3.x | UI framework |
| esbuild | Latest | Fast bundling |
| SASS | Latest | CSS preprocessing |

### Database

| Technology | Version | Purpose |
|------------|---------|---------|
| MariaDB | ≥ 10.4 | Relational database |

### Testing

| Technology | Version | Purpose |
|------------|---------|---------|
| Playwright Test | Latest | Unit, integration, and E2E testing |
| MSW | Latest | API mocking |
| Testing Library | Latest | DOM testing |

---

## Application Layers

### 1. Routes Layer

**Location**: `src/routes/`

**Responsibility**: Define HTTP endpoints and route requests to controllers.

```typescript
// src/routes/survey.ts
router.get('/create', requireLogin, surveyController.renderCreate);
router.post('/create', requireLogin, asyncHandler(surveyController.create));
```

**Patterns:**
- One route file per feature
- Middleware applied at route level
- Use `asyncHandler` for async routes

### 2. Middleware Layer

**Location**: `src/middleware/`

**Responsibility**: Request preprocessing, authentication, authorization.

**Key Middleware:**
- `requireLogin` - Ensures user is authenticated
- `requireOwner` - Ensures user owns resource
- `requirePerm` - Checks entity permissions
- `assignFlowFactory` - Permission checking for assignments
- `asyncHandler` - Error handling for async routes
- `genericErrorHandler` - Centralized error handling

### 3. Controller Layer

**Location**: `src/controller/`

**Responsibility**: Business logic orchestration, request/response handling.

```typescript
// Controller pattern
export default {
    async create(req: Request, res: Response): Promise<void> {
        // 1. Validate input
        // 2. Call service layer
        // 3. Handle response
    }
};
```

**Patterns:**
- Controllers don't access database directly
- All business logic in controllers
- Services handle data access
- Return data, not responses (except render/redirect)

### 4. Service Layer

**Location**: `src/modules/database/services/`

**Responsibility**: Database access, transactions, data integrity.

```typescript
// Service pattern
export class SurveyService {
    private surveyRepo: Repository<Survey>;
    
    async createSurvey(data: CreateSurveyDto): Promise<Survey> {
        // Database operations
        return await this.surveyRepo.save(survey);
    }
}
```

**Patterns:**
- One service per entity
- Use transactions for multi-step operations
- Return entities, not query results
- Handle database errors

### 5. Entity Layer

**Location**: `src/modules/database/entities/`

**Responsibility**: Database schema definition, relationships.

```typescript
@Entity()
export class Survey {
    @PrimaryGeneratedColumn('uuid')
    id: string;
    
    @Column()
    title: string;
    
    @ManyToOne(() => User)
    owner: User;
}
```

**Patterns:**
- One entity per table
- Define relationships with decorators
- Use TypeORM features (timestamps, etc.)
- Validation in controller, not entity

---

## Database Design

### Entity Relationship Overview

```
User ───┬─── Survey
        ├─── Event ───── EventRegistration
        ├─── PackingList ───── PackingItem
        ├─── ActivityPlan ───── ActivitySlot ───── SlotAssignment
        └─── DriversList ───── DriversItem

EntityPermissions ─── EntityAdminAssignment
```

### Key Entities

#### Users
- Authentication via OIDC
- Local accounts for guests
- Email verification system
- Password reset functionality

#### Surveys
- Multi-combination surveys
- Guest and user responses
- Ranked choice voting support

#### Events
- Event creation and management
- Registration system
- Invoice pool management
- Participant tracking

#### Packing Lists
- Shared packing coordination
- Item assignments
- Category organization

#### Activity Plans
- Time-boxed scheduling
- Role-based assignments
- Participant requirements
- Auto-assignment recommendations

#### Drivers Lists
- Driver coordination
- Seat management
- Participant assignments

### Permission System

**Table**: `entity_permissions`

Flexible permission system for all entity types:

```typescript
interface EntityPermissions {
    entityType: string;    // 'survey', 'event', 'packing', etc.
    entityId: string;      // UUID of the entity
    ownerId: number;       // User ID of owner
    defaultPermissions: {  // Default perms for all users
        view: boolean;
        edit: boolean;
        manage_assignments: boolean;
    };
    permMeta: Array<{      // Individual user permissions
        userId: number;
        permissions: string[];
    }>;
}
```

### Migrations

**Location**: `src/migrations/`

**Patterns:**
- Always create migrations for schema changes
- Never use `synchronize: true` in production
- Make migrations idempotent (use IF EXISTS/IF NOT EXISTS)
- Test both `up` and `down` methods
- Name migrations descriptively

---

## Frontend Architecture

### Modular Structure

**Location**: `src/public/js/`

```
js/
├── core/           # Foundation utilities
│   ├── http.ts             # HTTP client
│   ├── navigation.ts       # Navigation helpers
│   ├── form-utils.ts       # Form utilities
│   ├── formatting.ts       # Data formatting
│   └── permissions.ts      # Permission loader
├── shared/         # Shared UI behaviors
│   ├── alerts.ts           # Alert messages
│   ├── drag-drop.ts        # Drag & drop
│   ├── entity-assign.ts    # Assignment helpers
│   ├── inline-edit.ts      # Inline editing
│   ├── list-actions.ts     # List operations
│   └── ui-helpers.ts       # UI utilities
├── modules/        # Feature-specific widgets
│   ├── entity-select.ts    # Entity selector
│   ├── timezone-select.ts  # Timezone picker
│   ├── activity-*.ts       # Activity modules
│   └── ...
└── *.ts           # Page-level scripts
    ├── activity.ts
    ├── packing.ts
    ├── events.ts
    └── ...
```

### Module Pattern

```typescript
// Module initialization
export function init(): void {
    // Initialize module
}

// Expose via window
declare global {
    interface Window {
        Surveyor: {
            init: () => void;
        };
    }
}

window.Surveyor = window.Surveyor || {};
window.Surveyor.init = init;
```

### Client-Side Principles

1. **Reuse core/shared helpers** - Don't duplicate HTTP, DOM, or permission logic
2. **Load permissions early** - Use `loadPerms()` before checking permissions
3. **Type-safe DOM queries** - Cast elements to specific types
4. **Document with JSDoc** - Explain complex functions
5. **Minimize HTTP calls** - Batch when possible

---

## Authentication & Authorization

### Authentication (OIDC)

```typescript
// OIDC Provider: src/modules/oidc.ts
export const provider = new Provider(issuer, configuration);

// Strategy: Local accounts + OIDC
passport.use(new LocalStrategy(...));
passport.use('oidc', new Strategy(...));
```

**Flow:**
1. User attempts login
2. If OIDC configured, redirect to provider
3. Provider authenticates and returns
4. Application creates/updates local user
5. Session established

### Authorization (Permissions)

**Permission Engine**: `src/modules/permissionEngine.ts`

```typescript
interface PermissionEngine {
    has(user: User, entity: Entity, permission: string): boolean;
    grant(user: User, entity: Entity, permission: string): void;
    revoke(user: User, entity: Entity, permission: string): void;
}
```

**Permission Levels:**
- `VIEW` - Can view entity
- `EDIT` - Can edit entity
- `MANAGE_ASSIGNMENTS` - Can manage participants/assignments
- `ADMIN` - Full control (owner)

**Checking Permissions:**

Backend (middleware):
```typescript
router.get('/:id', requirePerm('VIEW'), controller.view);
```

Frontend (client-side):
```typescript
const perms = await loadPerms('activity', activityId);
if (perms.has('EDIT')) {
    // Show edit button
}
```

---

## Testing Architecture

### Testing Pyramid

```
       /\        E2E Tests (7 files, 424 tests)
      /  \       - Complete user workflows
     /    \      - Playwright + real browser
    /------\     
   / Database \  Database Tests (7 files, 1000+ tests)
  /   Tests   \  - Real database operations
 /------------\ 
/  Controller  \ Controller Tests (7 files, 518 tests)
| & Unit Tests | - Mocked services
|  (60 files)  | - Business logic focus
+--------------+
|Frontend Tests| Frontend Tests (43 files, 2900+ tests)
| (No Backend) | - MSW for API mocking
+--------------+ - Testing Library for DOM
```

### Testing Patterns

Surveyor uses a pragmatic test architecture: Vitest covers naturally isolated utilities and frontend helpers plus database-backed service integration canaries, while a small Playwright suite protects critical E2E workflows. Core services use the production TypeORM DataSource against disposable MariaDB rather than repository mocks. Tests protect production behavior and entity relationships, not private implementation details.

```typescript
// tests/unit/application-utilities.spec.ts
import {describe, expect, it} from 'vitest';
import {buildDateTotals} from '../../src/modules/lib/util';
import {createDateTotalsCase} from '../factories/dateTotalsFactory';

describe('date totals transformation', () => {
    it.each([createDateTotalsCase()])('$description', (testCase) => {
        expect(buildDateTotals(
            testCase.eventStart,
            testCase.eventEnd,
            testCase.registrations,
        )).toEqual(testCase.expectedTotals);
    });
});
```

Use Playwright only for focused E2E workflows that need the running app. Keep setup stable with factories/fixtures and prefer user-visible outcomes over DOM implementation details.
