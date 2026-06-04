# 变更影响矩阵

This document provides guidance on determining which documentation files need updates when code changes are made.

## Code → Documentation Mapping

The table maps changes to affected documentation files:
- New APIs/routes → route清单, integration-guide, architecture
- New environment variables → root markdown, operator-runbook, integration-guide
- Database changes → schema docs, architecture
- User flow changes → docs, README, handoff
- Large features → all above plus new architecture sections
- Terminology changes → integration-guide, global search/replace

## Memory Layer Updates

Handle these cases:
- Outdated facts → update memory files and index descriptions
- Relative times ("today", "recently") → convert to absolute dates
- Duplicate records → merge into one, update index
- Completed todos → delete (knowledge base is not an archive)
- Overturned decisions → delete old, keep new
- One-time context → delete

## Cross-Project Impact Checks

Commonly missed scenarios:
- Upstream API changes → downstream SDK docs
- Shared subdomains/routes/env vars → all consumer setup docs
- Auth middleware changes → all integration guides
- Infrastructure upgrades → version numbers in operator-runbooks

**Key question**: Does this change affect any SDKs, shared subdomains, cross-process protocols, or shared configs? If yes, search all dependent projects.

## Documentation Structure Convention

When adding capabilities, update four places:
1. **integration-guide** - external perspective (usage examples, error codes)
2. **architecture** - internal workings (data flow, state machines, design decisions)
3. **runbook** - operations (smoke tests, troubleshooting, env vars)
4. **handoff/CHANGELOG** - what's completed

API quick reference, environment variable tables, and terminology tables are high-frequency queries and must always reflect current state.
