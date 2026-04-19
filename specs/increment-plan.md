# Increment Plan

## ext-001: Generate topic-based interview podcasts

- **Type:** extension
- **FRD:** frd-podcast-generator.md
- **Scope:** Add authenticated podcast generation APIs, generate interview scripts with Azure OpenAI, synthesize audio with Azure AI Speech, add a mobile-first `/podcasts` page with transcript and browser playback, and integrate navigation/profile entry points.
- **Acceptance Criteria:**
  - [ ] Authenticated users can submit a topic and receive a generated episode.
  - [ ] Generated episodes include alternating host and guest transcript turns.
  - [ ] Users can play generated audio directly in the browser on phone-sized screens.
  - [ ] Failed generation or synthesis attempts surface actionable errors without breaking the current page.
  - [ ] Existing auth, profile, and admin behavior remains intact.
- **Test Strategy:**
  - API unit/integration tests for topic validation, authentication, Azure client error handling, and episode retrieval.
  - Playwright coverage for the end-to-end authenticated podcast generation flow.
  - Regression coverage for existing auth/profile/navigation/admin tests.
  - Final full-suite run via the repository test commands.
- **Gherkin Deltas:**
  - New: `Scenario: Authenticated user generates a podcast from a topic` — covers topic submission, transcript generation, and playable audio.
  - New: `Scenario: User sees validation feedback for an empty topic` — protects the mobile form and API contract.
  - New: `Scenario: User sees a recoverable error when audio generation fails` — documents Azure-dependent failure handling.
  - Regression: Existing authentication, profile, RBAC, and navigation scenarios must still pass unchanged.
- **Integration Points:**
  - Reuses `/api/auth/me` and auth cookie protection for new podcast APIs and pages.
  - Extends the authenticated navigation with a `Podcasts` route.
  - Adds Azure OpenAI and Azure AI Speech configuration to the API workload on AKS.
  - Preserves the existing auth/admin deployment shape in Azure Kubernetes Service (AKS).
- **Dependencies:** none
- **Rollback Plan:** Remove the new podcast routes, page, navigation entry, and Azure AI configuration, returning the app to the current auth-focused behavior.
