@podcast @api
Feature: Natural and responsive podcast generation

  Background:
    Given a signed-in podcast listener

  Scenario: Listener controls shape a validated episode
    When the listener generates "History of Boeing" for "Beginner", 5 minutes, and "Conversational"
    Then the podcast request succeeds
    And the episode keeps audience "Beginner", duration 5, and style "Conversational"
    And every podcast turn is spoken by alternating host and guest speakers
    And no podcast turn exceeds 80 words

  Scenario: Initial audio is progressively available
    When the listener generates "History of Boeing" for "Intermediate", 5 minutes, and "Conversational"
    Then the first audio segment is ready
    And later audio preparation is still in progress

  Scenario: Intervention preserves playback context
    Given the listener generated a podcast about "History of Boeing"
    When the listener asks "Why did jet engines matter?" at 60 seconds
    Then the intervention starts from 60 seconds
    And the intervention answer is no longer than 45 seconds

