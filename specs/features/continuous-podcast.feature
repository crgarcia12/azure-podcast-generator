Feature: Continuous hour-long podcast generation

  Scenario: Generate and stop a continuous podcast
    Given I start a continuous podcast about "History of Boeing" for 60 minutes
    Then the podcast reports generation progress
    And the first batch contains at least 5 ordered exchanges
    When I stop continuous generation
    Then the episode state is "stopped"
