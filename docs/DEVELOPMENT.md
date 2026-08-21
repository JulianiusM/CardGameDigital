# Development Guide

This guide covers the development workflow, tools, and best practices for contributing to Surveyor.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Building and Running](#building-and-running)
- [Testing](#testing)
- [Debugging](#debugging)
- [Git Workflow](#git-workflow)
- [Common Tasks](#common-tasks)

---

## Development Setup

### Prerequisites

- **Node.js**: >= 24.x
- **npm**: >= 10.x
- **MariaDB**: >= 10.4
- **Git**: Latest stable

### Initial Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/JulianiusM/Surveyor.git
   cd Surveyor
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up databases:**
   ```bash
   # Development database (configure .env)
   # Test database
   cp tests/.env.test.example tests/.env.test
   # E2E database
   cp .env.e2e.example .env.e2e
   ```

4. **Run migrations:**
   ```bash
   npm run typeorm:migrate
   ```

5. **Build the application:**
   ```bash
   npm run build
   ```

### IDE Setup

#### VS Code (Recommended)

Install these extensions:
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **TypeScript Vue Plugin** - TypeScript support
- **GitHub Copilot** - AI assistance (optional)

#### Configuration Files

- `.vscode/settings.json` - VS Code settings
- `.eslintrc` - ESLint rules
- `tsconfig.json` - TypeScript configuration

---

## Project Structure

```
surveyor/
├── src/                        # Application source code
│   ├── controller/             # Business logic controllers
│   ├── middleware/             # Express middleware
│   ├── migrations/             # Database migrations (TypeORM)
│   ├── modules/                # Application modules
│   │   ├── activity/           # Activity plan logic
│   │   ├── database/           # Database services and entities
│   │   │   ├── entities/       # TypeORM entities
│   │   │   └── services/       # Database service layer
│   │   ├── email.ts            # Email service
│   │   ├── lib/                # Utility libraries
│   │   ├── oidc.ts             # OIDC authentication
│   │   ├── permissionEngine.ts # Permission system
│   │   └── settings.ts         # Application settings
│   ├── public/                 # Static assets
│   │   ├── js/                 # Client-side JavaScript
│   │   │   ├── core/           # Core utilities (HTTP, navigation, forms)
│   │   │   ├── shared/         # Shared UI behaviors (alerts, drag-drop)
│   │   │   └── modules/        # Feature-specific widgets
│   │   └── style/              # SASS stylesheets
│   ├── routes/                 # Express route definitions
│   │   ├── api/                # API routes
│   │   └── *.ts                # Page routes
│   ├── types/                  # TypeScript type definitions
│   ├── views/                  # Pug templates
│   └── server.ts               # Application entry point
├── tests/                      # Test suite
│   ├── backend/                # Fast Vitest backend transformations, permissions, and services
│   ├── api/                    # Fast Vitest API contract/input-shaping tests
│   ├── frontend/               # Fast Vitest frontend helper/component tests
│   ├── e2e/                    # Focused Playwright critical-flow tests
│   ├── factories/              # Reusable production-shaped data builders
│   ├── fixtures/               # Shared fixture assets and seed data
│   └── support/                # Runner setup and shared utilities
├── scripts/                    # Build and utility scripts
├── docs/                       # Documentation
└── dist/                       # Compiled output (generated)
```

---

## Development Workflow

### Day-to-Day Development

1. **Start development servers:**
   ```bash
   npm run server
   ```
   This runs both the backend server and client build watcher.

2. **Make your changes:**
   - Edit source files in `src/`
   - Changes auto-reload with nodemon (backend) and esbuild (frontend)

3. **Write tests:**
   - Use factory-backed tests that verify production behavior without brittle implementation details
   - See [TESTING_GUIDE.md](TESTING_GUIDE.md)

4. **Run tests:**
   ```bash
   npm run test:quick      # Fast backend + frontend Vitest tests
   npm test              # Fast Vitest suite
   npm run test:all      # Vitest + build + Playwright E2E
   ```

5. **Commit your changes:**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   git push
   ```

### Feature Development Workflow

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Plan your changes:**
   - Database: Create migration if needed
   - Backend: Update entities, services, controllers
   - Frontend: Add/update views and client-side code
   - Tests: Write tests for all layers

3. **Implement incrementally:**
   - Start with database layer (entities, migrations)
   - Add service layer (business logic)
   - Add controller layer (request handling)
   - Add frontend (views and client code)
   - Write tests at each layer

4. **Test thoroughly:**
   ```bash
   npm run test:all
   ```

5. **Create pull request:**
   - Fill in PR template
   - Ensure CI passes
   - Request review

---

## Code Style

### TypeScript Conventions

```typescript
// ✅ Good: Async/await
async function getUserById(id: number): Promise<User> {
    return await userRepository.findOne({ where: { id } });
}

// ❌ Bad: Promise chaining
function getUserById(id: number): Promise<User> {
    return userRepository.findOne({ where: { id } }).then(user => user);
}

// ✅ Good: Interface for object shapes
interface CreateUserDto {
    username: string;
    email: string;
    password: string;
}

// ❌ Bad: Type for object shapes
type CreateUserDto = {
    username: string;
    email: string;
};

// ✅ Good: Explicit return types
function calculateTotal(items: Item[]): number {
    return items.reduce((sum, item) => sum + item.price, 0);
}

// ❌ Bad: Implicit return type
function calculateTotal(items: Item[]) {
    return items.reduce((sum, item) => sum + item.price, 0);
}
```

### Naming Conventions

- **Files**: kebab-case (`user-controller.ts`)
- **Classes**: PascalCase (`UserController`)
- **Functions**: camelCase (`getUserById`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_LOGIN_ATTEMPTS`)
- **Interfaces**: PascalCase with 'I' prefix optional (`User` or `IUser`)
- **Types**: PascalCase (`UserType`)

### Comments

```typescript
// ✅ Good: Explain why, not what
// Retry failed requests to handle transient network issues
const result = await retryRequest(request, 3);

// ❌ Bad: State the obvious
// Call retryRequest with request and 3
const result = await retryRequest(request, 3);

// ✅ Good: JSDoc for public APIs
/**
 * Retrieves a user by their unique identifier.
 * @param id - The user's ID
 * @returns Promise resolving to the User or null if not found
 */
async function getUserById(id: number): Promise<User | null>
```

### Code Organization

- **One class per file**
- **Group related functions**
- **Keep files under 500 lines** (split if larger)
- **Imports at top, organized by:**
  1. External libraries
  2. Internal modules
  3. Types
  4. Relative imports

---

## Building and Running

### Development Mode

```bash
# Run both server and client in watch mode
npm run server

# Or run separately:
npm run server:dev      # Backend only
npm run server:client   # Frontend build watcher
```

### Production Build

```bash
npm run build
```

This compiles:
1. SASS to CSS
2. TypeScript server code
3. TypeScript client code with esbuild
4. Copies assets and views

### Running Production Build

```bash
npm run run
```

### Build Scripts

- `npm run build:sass` - Compile SASS only
- `npm run build:server` - Compile server TypeScript only
- `npm run build:client` - Bundle client code only
- `npm run copy` - Copy static assets

---

## Testing

See [TESTING_GUIDE.md](TESTING_GUIDE.md) for comprehensive testing documentation.

### Quick Reference

```bash
# Vitest tests
npm test                    # Unit, frontend, and MariaDB integration canaries
npm run test:quick          # Database-free unit + frontend checks
npm run test:unit           # Naturally isolated production utilities
npm run test:frontend       # Frontend helper/component tests
npm run test:integration    # Production TypeORM services against MariaDB

# E2E tests (requires build + E2E database configuration)
npm run build
npm run e2e:prepare
npm run e2e

# Complete test suite
npm run test:all            # Vitest + build + focused Playwright E2E
```

### Writing New Tests

Use the cheapest stable test that protects the use case:

1. **Create or reuse a factory when the data shape is non-trivial:**
   ```typescript
   // tests/factories/eventFactory.ts
   export function createEventInput(overrides: Partial<EventInput> = {}): EventInput {
       return {
           title: 'Summer Camp',
           startDate: '2026-08-05',
           endDate: '2026-08-07',
           ...overrides,
       };
   }
   ```

2. **Write a Vitest test against production behavior:**
   ```typescript
   // tests/unit/application-utilities.spec.ts
   import {describe, expect, it} from 'vitest';
   import {buildDateTotals} from '../../src/modules/lib/util';
   import {createDateTotalsCase} from '../factories/dateTotalsFactory';

   const cases = [createDateTotalsCase()];

   describe('date totals transformation', () => {
       it.each(cases)('$description', (testCase) => {
           expect(buildDateTotals(
               testCase.eventStart,
               testCase.eventEnd,
               testCase.registrations,
           )).toEqual(testCase.expectedTotals);
       });
   });
   ```

Keep Playwright E2E tests broad and shallow; use them for critical workflows rather than every validation branch.

---

## Debugging

### Backend Debugging

#### VS Code

1. Add to `.vscode/launch.json`:
   ```json
   {
       "type": "node",
       "request": "launch",
       "name": "Debug Server",
       "program": "${workspaceFolder}/src/server.ts",
       "preLaunchTask": "npm: build",
       "skipFiles": ["<node_internals>/**"],
       "runtimeArgs": ["-r", "ts-node/register"]
   }
   ```

2. Set breakpoints in VS Code
3. Press F5 to start debugging

#### Console Debugging

```bash
# With database query logging
npm test

# With Node.js inspector
node --inspect dist/server.js
```

### Frontend Debugging

```javascript
// Browser console
console.log('Debug info:', data);
console.table(array);
debugger; // Breakpoint in browser devtools
```

### Test Debugging

```bash
# Run specific test with debugging
npx vitest run tests/unit/application-utilities.spec.ts --inspect

# Debug with VS Code
# Add to launch.json:
{
    "type": "node",
    "request": "launch",
    "name": "Debug Playwright Tests",
    "program": "${workspaceFolder}/node_modules/.bin/playwright",
    "args": ["test", "${file}"],
    "console": "integratedTerminal"
}
```

---

## Git Workflow

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring
- `test/description` - Test improvements

### Commit Messages

Follow conventional commits:

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code style (formatting)
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance

Examples:
```
feat(activity): add auto-assignment feature

Implements automatic assignment of participants to activity slots
based on their availability and preferences.

Closes #123
```

```
fix(auth): prevent login with expired token

Adds token expiration check before authentication.
```

### Pull Request Process

1. **Create branch** from `develop`
2. **Make changes** and commit
3. **Push to GitHub**
4. **Create PR** with description:
   - What changed
   - Why it changed
   - How to test
5. **CI checks** must pass
6. **Get review** from team member
7. **Merge** when approved

---

## Common Tasks

### Add a Database Migration

```bash
# Generate migration file
npm run typeorm migration:create src/migrations/AddNewFeature

# Edit the migration file
# Run migration
npm run typeorm:migrate

# Revert if needed
npm run typeorm migration:revert
```

### Add a New Route

1. **Define route** in `src/routes/myFeature.ts`
2. **Create controller** in `src/controller/myFeatureController.ts`
3. **Add an isolated utility test** in `tests/unit/`, or a MariaDB-backed route/service canary in `tests/integration/`
4. **Register route** in `src/server.ts`

### Add a New Entity

1. **Create entity** in `src/modules/database/entities/MyEntity.ts`
2. **Create service** in `src/modules/database/services/MyEntityService.ts`
3. **Create migration** to add table
4. **Add a database-backed service canary** in a grouped integration suite such as `tests/integration/core-services.spec.ts`

### Add Frontend Module

1. **Create module** in `src/public/js/modules/my-feature.ts`
2. **Add initialization** to page script
3. **Create tests** in `tests/frontend/ui-behaviors.spec.ts` or a future component-oriented suite
4. **Update view** in `src/views/`

### Update Dependencies

```bash
# Check for updates
npm outdated

# Update package
npm update package-name

# Update all minor/patch versions
npm update

# Run tests after updating
npm run test:all
```

---

## Environment Variables

### Development

Create `.env` file:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=surveyor
DB_PASS=surveyor
DB_NAME=surveyor
SESSION_SECRET=your-secret-key
OIDC_ISSUER=https://your-oidc-provider
```

### Testing

- `tests/.env.test` - Unit/integration tests
- `.env.e2e` - E2E tests

### Production

Set environment variables in deployment platform:
- Database credentials
- Session secret
- OIDC configuration
- Email configuration

---

## Performance Considerations

### Backend

- Use database indexes
- Implement pagination for large datasets
- Use transactions for multi-step operations
- Cache frequently accessed data
- Use connection pooling

### Frontend

- Minimize bundle size with esbuild
- Lazy load modules when possible
- Debounce user input handlers
- Use efficient DOM queries
- Minimize reflows/repaints

### Database

- Add indexes on foreign keys
- Use EXPLAIN to analyze slow queries
- Avoid N+1 queries
- Use eager loading when appropriate
- Monitor query execution times

---

## Security Best Practices

### General

- ✅ Never commit secrets or credentials
- ✅ Use environment variables for config
- ✅ Validate all user input
- ✅ Sanitize output in views
- ✅ Use parameterized queries
- ✅ Hash passwords with bcrypt
- ✅ Use HTTPS in production
- ✅ Keep dependencies updated

### Backend

- Use express-validator for input validation
- Implement rate limiting
- Use CSRF protection
- Sanitize file uploads
- Use secure session configuration

### Frontend

- Escape user content in templates
- Use CSP headers
- Validate on client and server
- Use secure cookies
- Implement CORS properly

---

## Troubleshooting

### Common Issues

#### Tests Failing After Dependency Update

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
npm run test:all
```

#### Database Connection Errors

```bash
# Check database is running
# Verify credentials in .env files
# Check migrations are up to date
npm run typeorm:migrate
```

#### Build Errors

```bash
# Clean build
rm -rf dist
npm run build
```

#### E2E Tests Timing Out

```bash
# Ensure app is built
npm run build
# Increase timeout in playwright.config.ts
```

---

## Getting Help

- **Documentation**: Check [docs/](.)
- **Testing**: See [TESTING_GUIDE.md](TESTING_GUIDE.md)
- **Architecture**: See [ARCHITECTURE.md](ARCHITECTURE.md)
- **Issues**: Create GitHub issue with reproduction steps

---

**Last Updated:** December 10, 2025  
**Next Review:** March 10, 2026
