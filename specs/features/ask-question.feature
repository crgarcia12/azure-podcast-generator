@ask-question @podcasts
Feature: Mid-episode listener questions steer the podcast

  As a listener I want to ask a question while my episode is playing so the
  host steers the conversation to answer it before continuing the original
  thread.

  FRD: specs/frd-podcast-generator.md
  Acceptance: see top-level specification "In-Car Ask the Podcast"

  Background:
    Given the application is running
    And no users exist in the system

  # ──────────────────────────────────────────────
  # API: authentication is required
  # ──────────────────────────────────────────────

  @api @auth
  Scenario: Unauthenticated requests are rejected
    When I send a POST request to "/api/podcasts/some-episode-id/questions" with json body:
      """
      {"question":"hi","playbackPositionSeconds":0}
      """
    Then the response status should be 401

  # ──────────────────────────────────────────────
  # API: end-to-end with the mock provider
  # ──────────────────────────────────────────────

  @api @mock-provider
  Scenario: Mock provider returns a host-acknowledge → guest-answer → host-bridge segment
    Given a user "alex" exists with password "SecurePass123!"
    And the user "alex" is signed in
    And alex has generated an episode on the topic "How the universe works"
    When alex submits the question "What happens if I cross the event horizon with one eye only, what do I see" at 42 seconds
    Then the response status should be 200
    And the steered segment response has a "segmentId" string
    And the steered segment response has an "audioUrl" string
    And steered segment turn 1 speaker equals "host"
    And steered segment turn 2 speaker equals "guest"
    And the last steered segment turn speaker equals "host"
    And steered segment turn 2 text contains "event horizon"

  # ──────────────────────────────────────────────
  # API: validation of the question body
  # ──────────────────────────────────────────────

  @api @validation
  Scenario: Empty questions are rejected
    Given a user "alex" exists with password "SecurePass123!"
    And the user "alex" is signed in
    And alex has generated an episode on the topic "How the universe works"
    When alex submits the question "" at 0 seconds
    Then the response status should be 400

  # ──────────────────────────────────────────────
  # API: segment audio is streamable to the owner
  # ──────────────────────────────────────────────

  @api @audio
  Scenario: Steered segment audio is downloadable
    Given a user "alex" exists with password "SecurePass123!"
    And the user "alex" is signed in
    And alex has generated an episode on the topic "How the universe works"
    And alex has asked "What is dark matter" at 12 seconds
    When alex requests the steered segment audio
    Then the response status should be 200
    And the response content type starts with "audio/"
