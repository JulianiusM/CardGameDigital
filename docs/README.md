# Surveyor Documentation

Welcome to the Surveyor documentation. This directory contains comprehensive documentation for developers, testers, and
AI agents working on the Surveyor application.

## Documentation Structure

### 📚 For Developers

#### Getting Started

- **[../README.md](../README.md)** - Project overview, setup, and quick start
- **[DEVELOPMENT.md](DEVELOPMENT.md)** - Development workflow and guidelines
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture and design

#### Development Guides

- **[CODING_STANDARDS.md](CODING_STANDARDS.md)** - TypeScript, code style, and best practices
- **[DATABASE.md](DATABASE.md)** - Database entities, migrations, and patterns
- **[FRONTEND.md](FRONTEND.md)** - Frontend architecture and modular structure
- **[ACTIVITY_REQUIREMENTS_ALGORITHM.md](ACTIVITY_REQUIREMENTS_ALGORITHM.md)** - Shift requirement computation and
  coverage model

#### Testing

- **[TESTING_GUIDE.md](TESTING_GUIDE.md)** - Complete testing guide (Vitest + focused Playwright E2E)
- **[FRONTEND_TESTING.md](FRONTEND_TESTING.md)** - Frontend testing with MSW and Testing Library

#### Maintenance

- **[CI_CD.md](CI_CD.md)** - CI/CD pipeline and GitHub Actions
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Deployment procedures and configuration
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Common issues and solutions

### 🤖 For AI Agents

- **[../AGENTS.md](../AGENTS.md)** - General AI agent guide
- **[../.github/copilot-instructions.md](../.github/copilot-instructions.md)** - GitHub Copilot instructions
- **[../.github/copilot/](../.github/copilot/)** - Modular Copilot guidelines

### 👥 For End Users

- **[user-guide/](user-guide/)** - End-user documentation for app features
    - **[GETTING_STARTED.md](user-guide/GETTING_STARTED.md)** - Registration and login
    - **[SURVEYS.md](user-guide/SURVEYS.md)** - Creating and managing surveys
    - **[EVENTS.md](user-guide/EVENTS.md)** - Event registration and management
    - **[PACKING_LISTS.md](user-guide/PACKING_LISTS.md)** - Managing packing lists
    - **[ACTIVITY_PLANS.md](user-guide/ACTIVITY_PLANS.md)** - Activity planning and scheduling
    - **[DRIVERS_LISTS.md](user-guide/DRIVERS_LISTS.md)** - Driver coordination
    - **[DASHBOARD.md](user-guide/DASHBOARD.md)** - Using your dashboard

### 📋 Reference

- **[API.md](API.md)** - API endpoints and usage
- **[PERMISSIONS.md](PERMISSIONS.md)** - Permission system documentation
- **[CHANGELOG.md](CHANGELOG.md)** - Version history and changes

### 📦 Archive

Historical and deprecated documentation:

- **[archive/REFACTORING_SUMMARY.md](archive/REFACTORING_SUMMARY.md)** - Test refactoring history
- **[archive/TESTING_INFRASTRUCTURE.md](archive/TESTING_INFRASTRUCTURE.md)** - Original testing infrastructure docs

## Quick Links

### I want to...

- **Set up my development environment** → [../README.md](../README.md)
- **Write tests** → [TESTING_GUIDE.md](TESTING_GUIDE.md)
- **Understand the codebase** → [ARCHITECTURE.md](ARCHITECTURE.md)
- **Create a database migration** → [DATABASE.md](DATABASE.md)
- **Add a new feature** → [DEVELOPMENT.md](DEVELOPMENT.md)
- **Deploy the application** → [DEPLOYMENT.md](DEPLOYMENT.md)
- **Use as AI agent** → [../AGENTS.md](../AGENTS.md)
- **Learn as end user** → [user-guide/GETTING_STARTED.md](user-guide/GETTING_STARTED.md)

## Documentation Standards

### For Contributors

When adding or updating documentation:

1. **Keep it current** - Update docs when code changes
2. **Be clear** - Write for your audience (developer vs user)
3. **Use examples** - Show, don't just tell
4. **Link appropriately** - Cross-reference related docs
5. **Follow structure** - Use consistent headings and formatting

### Markdown Guidelines

- Use relative links for internal docs
- Include table of contents for long documents
- Use code blocks with language specification
- Add navigation links at top and bottom of long docs
- Keep line length reasonable for readability

### Document Ownership

| Document         | Owner        | Update Frequency      |
|------------------|--------------|-----------------------|
| TESTING_GUIDE.md | Test team    | With test changes     |
| ARCHITECTURE.md  | Tech lead    | With major changes    |
| User guides      | Product team | With feature releases |
| API.md           | Backend team | With API changes      |
| CI_CD.md         | DevOps team  | With pipeline changes |

## Getting Help

- **Questions about code?** Check [ARCHITECTURE.md](ARCHITECTURE.md) or [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- **Questions about tests?** Check [TESTING_GUIDE.md](TESTING_GUIDE.md)
- **Questions about deployment?** Check [DEPLOYMENT.md](DEPLOYMENT.md)
- **Questions about features?** Check [user-guide/](user-guide/)

## Contributing to Documentation

See [DEVELOPMENT.md](DEVELOPMENT.md) for guidelines on contributing documentation changes.

---

**Last Updated:** December 10, 2025  
**Version:** 1.0
