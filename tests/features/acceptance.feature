Feature: Natural and responsive podcast listening

  Scenario: Default controls are visible and submitted
    Given I am signed in
    When I open "/podcasts"
    Then the audience level is "Intermediate"
    And the episode length is "5 minutes"
    And the conversation style is "Conversational"
    When I generate an episode with topic "History of Boeing"
    Then the generation request contains audience "Intermediate", duration 5, and style "Conversational"

  Scenario: Beginner transcript satisfies conversational validation
    Given I am signed in
    And the podcast provider is "mock"
    When I generate "History of Boeing" for audience "Beginner", duration "5 minutes", and style "Conversational"
    Then the transcript contains at least one "host" turn
    And the transcript contains at least one "guest" turn
    And every transcript turn contains spoken text
    And every transcript turn contains at most 80 words

  Scenario: Playback is available before full synthesis completes
    Given I am signed in
    And the podcast provider is "mock"
    When I generate an episode with topic "History of Boeing"
    Then I see the status "Generating script"
    And I see the status "Preparing audio"
    When the first audio segment becomes ready
    Then the play control is enabled
    And the complete episode synthesis is still in progress

  Scenario: Text intervention starts within the latency targets
    Given I am signed in
    And a mock-provider episode is playing at 60 seconds
    When I submit the text question "Why did jet engines matter?"
    Then episode playback is paused
    And the question is acknowledged within 3 seconds
    And the intervention answer starts playing within 8 seconds

  Scenario: Episode resumes at the interruption position
    Given I interrupted a mock-provider episode at 60 seconds
    And the intervention answer is playing
    When the intervention answer finishes
    Then the original episode resumes within 2 seconds
    And its playback position is between 58 and 62 seconds

  Scenario: Failed intervention preserves the episode
    Given I am signed in
    And a mock-provider episode is paused at 60 seconds
    And the next intervention generation will fail
    When I submit the text question "Why did jet engines matter?"
    Then I see "We couldn't answer that question"
    And I see a "Retry question" control
    And I see a "Resume episode" control
    When I activate "Resume episode"
    Then the existing episode resumes between 58 and 62 seconds
    And no new episode generation request is sent

  Scenario: Podcast interaction is accessible
    Given I am signed in
    And I am using only the keyboard
    When I open "/podcasts"
    Then I can focus the audience, length, style, generate, play, and "Ask a question" controls
    When I submit the text question "Why did jet engines matter?"
    Then an accessible status announces "Question received"
    And an accessible status announces "Answering question"
    When the episode resumes
    Then an accessible status announces "Episode resumed"

  Scenario: Timing telemetry excludes listener content
    Given I am signed in
    And the podcast provider is "mock"
    When I generate "History of Boeing" and ask "Why did jet engines matter?"
    Then telemetry contains stage names, durations, provider "mock", and success statuses
    And telemetry does not contain "History of Boeing"
    And telemetry does not contain "Why did jet engines matter?"
    And telemetry contains no transcript text, credentials, or audio payloads
